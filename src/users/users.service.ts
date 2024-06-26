import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { Users } from 'src/common/entities/users.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from 'src/notifications/redis/redis.service';
import { GeoLocationService } from '../notifications/streams/user-location-streams/user-location.service';
import { AwsService } from 'src/aws/aws.service';
import { Clients } from 'src/common/entities/clients.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientsDto } from './dto/clients.dto';
import { UtilsService } from 'src/utils/utils.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(Clients)
    private clientsRepository: Repository<Clients>,
    private utilsService: UtilsService,
    @Inject(RedisService)
    private redisService: RedisService,
    @Inject(GeoLocationService)
    private geoLocationService: GeoLocationService,
    private readonly awsService: AwsService,
  ) {}

  async getUserByEmail(email: string) {
    return this.usersRepository.findOne({
      where: {
        email,
      },
    });
  }

  async getAllUsers() {
    return this.usersRepository.find();
  }

  async getUserInfoByEmail(email: string) {
    const userInfo = await this.usersRepository.findOne({
      where: { email },
      select: [
        'id',
        'email',
        'name',
        'nickname',
        'profile_image',
        'phone_number',
      ],
    });
    return userInfo;
  }
  // 유저 상세 찾기

  async findOne(id: number) {
    const users = await this.usersRepository.findOne({
      where: { id },
      select: [
        'id',
        'email',
        'name',
        'nickname',
        'profile_image',
        'phone_number',
      ],
    });

    if (!users) {
      throw new NotFoundException('유저가 존재하지 않습니다.');
    }

    return users;
  }

  // 수정

  async update(
    id: number,
    user: Users,
    updateUserDto: UpdateUserDto,
    file: Express.Multer.File,
  ) {
    const { name, nickname } = updateUserDto;
    // const users = await this.findUserById(user.id);
    const uploadedFile = file && (await this.awsService.uploadImage(file));

    if (!user) {
      throw new NotFoundException('유저가 존재하지 않습니다.');
    }

    if (id !== user.id) {
      throw new UnauthorizedException('정보가 일치하지 않습니다.');
    }
    const updateUser = await this.usersRepository.update(user.id, {
      name,
      nickname,
      profile_image: uploadedFile,
    });

    return updateUser;
  }

  async findUserById(id: number) {
    return await this.usersRepository.findOne({ where: { id } });
  }

  // 삭제

  async remove(userId: number, user: Users) {
    const users = await this.findUserById(userId);

    if (!users) {
      throw new NotFoundException('유저가 존재하지 않습니다.');
    }

    if (userId !== users.id) {
      throw new UnauthorizedException('정보가 일치하지 않습니다.');
    }

    return await this.usersRepository.delete(userId);
  }

  // 클라이언트 정보 처리(클라 id, 위경도) 및 레디스 저장
  async saveClientsInfo(clientsDto: ClientsDto) {
    const { user_id, client_id, push_token, latitude, longitude } = clientsDto;
    let clientsInfo = await this.clientsRepository.findOne({
      where: [
        { client_id: client_id },
        { user_id: user_id },
        { push_token: push_token },
      ],
    });

    let area: string;
    let updateNeeded = false;

    if (clientsInfo) {
      const isUpdated =
        clientsInfo.push_token !== push_token ||
        clientsInfo.latitude !== latitude ||
        clientsInfo.longitude !== longitude;

      if (isUpdated) {
        Object.assign(clientsInfo, clientsDto);
        updateNeeded = true;
      }
    } else {
      clientsInfo = this.clientsRepository.create(clientsDto);
      updateNeeded = true;
    }

    if (updateNeeded) {
      await this.clientsRepository.save(clientsInfo);
    }

    if (latitude !== undefined && longitude !== undefined && updateNeeded) {
      area = await this.geoLocationService.getAreaFromCoordinates(
        latitude,
        longitude,
        user_id,
        client_id,
      );

      await this.redisService.client.set(`user:${user_id}:area`, area);
    }

    return { clientsInfo, area };
  }

  // 클라이언트의 푸시 토큰 검증 함수
  async getTokenByIdentifiers(
    userId?: number,
    clientId?: string,
  ): Promise<string> {
    let user: Clients;
    if (userId) {
      user = await this.clientsRepository.findOneBy({ user_id: userId });
    } else if (clientId) {
      user = await this.clientsRepository.findOneBy({ client_id: clientId });
    }

    console.log('토픽 검증하는 함수의 user => ', user);

    return user ? user.push_token : null;
  }

  // 새벽 2시마다 만료된 토큰 삭제
  @Cron(CronExpression.EVERY_DAY_AT_2AM, {
    timeZone: 'Asia/Seoul',
  })
  async cleanUpOldClientsData() {
    this.logger.log('Running cleanup job for clients');
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    await this.clientsRepository
      .createQueryBuilder()
      .delete()
      .from(Clients)
      .where('updated_at < :oneWeekAgo', { oneWeekAgo })
      .execute();

    this.logger.log('Cleanup job completed');
  }

  //@@@@@@@@@@@@
  async getUserIdByEmail(email: string): Promise<number> {
    try {
      // 이메일을 사용하여 사용자의 아이디를 조회
      const user = await this.usersRepository.findOne({ where: { email } });
      if (!user) {
        throw new Error('사용자를 찾을 수 없음');
      }

      return user.id;
    } catch (error) {
      console.error('사용자 아이디 조회 실패:', error);
      throw error;
    }
  }

  async updateClientUserId(clientId: string, userId: number) {
    try {
      // 클라이언트의 user_id 업데이트
      const client = await this.clientsRepository.findOne({
        where: { client_id: clientId },
      });
      if (!client) {
        throw new Error('클라이언트를 찾을 수 없음');
      }

      client.user_id = userId;
      await this.clientsRepository.save(client);
    } catch (error) {
      console.error('클라이언트 user_id 업데이트 실패:', error);
      throw error;
    }
  }
}

// // 사용자에 대한 client_id 검색 또는 생성 함수
// async getClientAndTokenByIdentifiers(
//   userId?: number,
//   clientId?: string,
// ): Promise<{ client_id: string; push_token: string | null }> {
//   let clientInfo;

//   /**userid / clientId
//    * O O -> (로그인 회원)return clientId
//    * O X -> (로그인 회원)새로 uuid 생성해서 userId랑 clientId를 Clients 테이블에 저장
//    * X O -> (비회원)
//    */

//   if (!clientId) {
//     clientInfo = await this.clientsRepository.findOne({
//       where: { user_id: userId },
//     });
//   } else if (clientId) {
//     clientInfo = await this.clientsRepository.findOne({
//       where: { client_id: clientId },
//     });
//     // userId를 업데이트 해줘야되지 않냐? + clientId만 가진 비회원도 여기에 걸린다가 문제.
//   }

//   if (!userId && clientId) {
//   }

//   // 클라이언트 정보가 없으면 새로 생성 (주로 사용자 ID 기반)
//   if (!clientInfo && userId) {
//     // UtilsService를 사용하여 UUID 생성
//     const newClientId = this.utilsService.getUUID();
//     clientInfo = this.clientsRepository.create({
//       user_id: userId,
//       client_id: newClientId,
//     });
//     await this.clientsRepository.save(clientInfo);
//   }

//   // 클라이언트 정보가 여전히 없으면 예외 처리
//   if (!clientInfo) {
//     throw new Error('클라이언트 정보가 없습니다.');
//   }

//   return {
//     client_id: clientInfo.client_id,
//     push_token: clientInfo.push_token || null,
//   };
// }
