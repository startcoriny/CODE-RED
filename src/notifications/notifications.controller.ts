import {
  Controller,
  Get,
  UseGuards,
  Logger,
  Post,
  Body,
  Param,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthGuard } from '@nestjs/passport';
import { UserInfo } from 'src/common/decorator/user.decorator';
import { Users } from 'src/common/entities/users.entity';
import { FcmService } from './messaging-services/firebase/fcm.service';
import { RealtimeNotificationService } from './streams/realtime-notifications.service';
import { JwtAuthGuard } from 'src/auth/guard/client-custom.guard';

@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(`NotificationsController.name`);
  constructor(
    private notificationsService: NotificationsService,
    private realtimeNotificationsService: RealtimeNotificationService,
    private fcmService: FcmService,
  ) {}

  // FCM 발송된 알림 목록 조회 API
  @UseGuards(JwtAuthGuard)
  @Get()
  async getAllNotifications(
    @UserInfo() user: Users,
    @Body() body: { client_id: string },
  ) {
    const messageLists = await this.notificationsService.getAllNotifications(
      user.id,
      body.client_id,
    );
    return messageLists;
  }

  // 알림 목록 중 특정 알림 메세지 상세 조회 및 Read 상태 업데이트 API
  @UseGuards(JwtAuthGuard)
  @Get('/:messageId')
  async getNotificationByIdAndUpdateStatus(
    @Param('messageId') messageId: number,
  ) {
    const readMessage =
      await this.notificationsService.getNotificationByIdAndUpdateStatus(
        messageId,
      );
    return readMessage;
  }

  @Post('send-push')
  async sendTestNotification(@Body() body: { title: string; message: string }) {
    console.log(`알림 전송 성공, message:${body.message} `);
    const area = '전라남도 화순군';
    await this.realtimeNotificationsService.realTimeMonitoringStartAndProcessPushMessages(
      area,
    );
    return this.fcmService.sendPushNotification(body.title, body.message);
  }
}

/**
   * 특정 사용자 위치에 따른 알림 목록 조회
   *   @UseGuards(AuthGuard('jwt'))
  @Get()
  async getUserNotifications(@UserInfo() user: Users) {
    const startTime = Date.now();

    const notificationsLists =
      await this.notificationsService.getUserNotifications(user.id);

    const endTime = Date.now();
    const executionTime = endTime - startTime;
    this.logger.log(`getUserNotifications execution time: ${executionTime} ms`);

    return notificationsLists;
  }

   */
