import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { DisasterMessageParserService } from 'src/utils/disaster-message.parser.service';
import {
  ClientsInfo,
  DisasterMessage,
  RedisStreamResult,
} from 'src/common/types/disaster-message.interface';
import { FcmService } from '../messaging-services/firebase/fcm.service';
import { RedisKeys } from '../redis/redis.keys';
import { Interval } from '@nestjs/schedule';

@Injectable()
export class RealtimeNotificationService {
  private readonly logger = new Logger(RealtimeNotificationService.name);

  constructor(
    private redisService: RedisService,
    private parserService: DisasterMessageParserService,
    private fcmService: FcmService,
  ) {}

  async realTimeMonitoringStartAndProcessPushMessages(area: string) {
    const disasterStreamKey = RedisKeys.disasterStream(area);

    await this.ensureStreamAndConsumerGroupExist(disasterStreamKey);

    this.logger.log(
      '1. 모니터링 시작, Starting message monitoring service...' + area,
    );

    try {
      this.logger.log(
        '2. 스트림 메세지 읽기 시도 중, Attempting to read from stream...',
      );

      // 재난 데이터 스트림에서 메시지 읽기
      const messages = (await this.redisService.client.xreadgroup(
        'GROUP',
        'notificationGroup',
        'realtimeService',
        'BLOCK',
        15000,
        'STREAMS',
        disasterStreamKey,
        '>',
      )) as RedisStreamResult[];

      console.log('messages', messages);

      // 메세지가 있을시 메세지 전송
      if (messages && messages.length > 0) {
        this.logger.log(
          `3. 메세지 수신 성공: Received ${messages.length} messages from stream.`,
        );
        await this.NewStreamMessageParsingAndProcessing(messages, area);
      } else {
        this.logger.log(
          '모니터링 종료-- 수신 메세지 없음❎ : No new messages in the stream.',
        );
      }
    } catch (error) {
      this.logger.error('재난 데이터 스트림 모니터링 에러: ' + error.message);
    }
  }

  // 지역명을 기반 스트림-컨슈머 그룹 생성
  private async ensureStreamAndConsumerGroupExist(disasterStreamKey: string) {
    try {
      await this.redisService.client.xgroup(
        'CREATE',
        disasterStreamKey,
        'notificationGroup',
        '$',
        'MKSTREAM',
      );
    } catch (error) {
      if (!error.message.includes('BUSYGROUP')) {
        this.logger.error('컨슈머 그룹 생성 실패:', error);
      }
    }
  }

  // 새 메세지 수신 성공 -> 파싱 -> 알림 전송
  async NewStreamMessageParsingAndProcessing(
    messages: RedisStreamResult[],
    area: string,
  ) {
    // 읽은 알림인지 확인
    for (const [stream, streamMessages] of messages) {
      for (const [messageId, messageFields] of streamMessages) {
        const isProcessed = await this.isMessageProcessed(messageId);
        if (!isProcessed) {
          this.logger.log(
            `메시지 처리 중... Processing message ID ${messageId} from stream ${stream}.`,
          );

          // Stream 메세지를 DisasterMessage 인터페이스에 맞게 파싱
          const parsedMessage =
            this.parserService.parseDisasterMessage(messageFields);
          console.log('parsedMessage:', parsedMessage);

          //  푸시 알림 전송 처리
          await this.processPushNotificationMessage(area, parsedMessage);

          // 메세지 확인 처리
          await this.redisService.client.xack(
            stream,
            'notificationGroup',
            messageId,
          );

          // XACK 중복 처리 방지
          await this.checkingMessageAsProcessed(messageId);

          this.logger.log(
            `메시지 확인 처리(XACK), Message ID ${messageId} acknowledged.`,
          );
        } else {
          this.logger.log(
            `메시지 중복 처리 건너뛰기, Skipping duplicated message ID ${messageId}.`,
          );
        }
      }
    }
  }

  // 메세지 ID가 집합에 있는지 확인(존재하면 0, 아니면 1 반환)
  private async isMessageProcessed(messageId: string): Promise<boolean> {
    const processed = await this.redisService.client.sismember(
      'processedMessages',
      messageId,
    );
    return processed === 1;
  }

  // 알림 전송 처리
  private async processPushNotificationMessage(
    area: string,
    disasterData: DisasterMessage,
  ) {
    // 회원/비회원 ID 미식별시 Early Return
    if (!disasterData.user_id && !disasterData.client_id) {
      this.logger.error(
        `알림 전송 실패 - 회원/비회원 ID 없음: ${JSON.stringify(disasterData)}`,
      );
      return;
    }

    // 사용자 위치 정보 스트림 조회 후 지역별 사용자 그룹에 알림 전송
    const clientsInfoList = await this.getClientsInfoInArea(area);
    const title = '긴급 재난 경보';
    const message = disasterData.content;
    for (const clientsInfo of clientsInfoList) {
      if (clientsInfo.user_id || clientsInfo.client_id) {
        this.fcmService.sendPushNotification(
          title,
          message,
          clientsInfo.user_id || undefined,
          clientsInfo.client_id,
        );
      }
    }
  }

  private async getClientsInfoInArea(area: string): Promise<ClientsInfo[]> {
    const userLocationsStreamKey = RedisKeys.userLocationsStream(area);
    const messages = await this.redisService.client.xrange(
      userLocationsStreamKey,
      '-',
      '+',
    );

    return messages.map(([id, fields]) => {
      const clientsInfo: ClientsInfo = {};
      for (const [key, value] of fields) {
        if (key === 'user_id' && value !== 'undefined') {
          clientsInfo.user_id = parseInt(value);
        } else if (key === 'client_id' && value !== 'undefined') {
          clientsInfo.client_id = value;
        }
      }
      return clientsInfo;
    });
  }

  // XACK 중복처리 방지하기 위해 Set 형태로 저장하고, 만료시간을 두어 자동 정리
  private async checkingMessageAsProcessed(messageId: string): Promise<void> {
    await this.redisService.client.sadd('processedMessages', messageId);
    await this.redisService.client.expire(messageId, 3600); // 1시간 만료
  }

  // 오래된 메세지 정리 : 실시간 모니터링으로 읽고 Set으로 관리되는 메세지를 24시간 마다 정리
  @Interval(86400000)
  async cleanupOldProcessedMessages() {
    const allMessageIds =
      await this.redisService.client.smembers('processedMessages');
    for (const messageId of allMessageIds) {
      if (!(await this.redisService.client.exists(messageId))) {
        await this.redisService.client.srem('processedMessages', messageId);
      }
    }
  }

  // 재난 데이터 스트림 메세지 자동 정리
  @Interval(86400000)
  async trimDisasterStreams() {
    let cursor = '0';
    do {
      const reply = await this.redisService.client.scan(
        cursor,
        'MATCH',
        'disasterStream:*',
        'COUNT',
        100,
      );
      cursor = reply[0];
      const keys = reply[1];

      for (const streamKey of keys) {
        await this.redisService.client.xtrim(streamKey, 'MAXLEN', '~', 1000); // 스트림 크기 조정
        this.logger.log(`재난 데이터 스트림 ${streamKey} 정리 완료.`);
      }
    } while (cursor !== '0');
  }
}
