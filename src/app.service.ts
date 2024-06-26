import { Injectable } from '@nestjs/common';
import { NewsService } from './news/news.service';
import { AuthService } from './auth/auth.service';
import { DestinationRiskService } from './destination-risk/destination-risk.service';
import { SheltersService } from './shelters/shelters.service';
import { DisasterService } from './notifications/streams/disaster-streams/disaster.service';
import _ from 'lodash';
import { disasterKeywords } from './utils/keywords';

@Injectable()
export class AppService {
  constructor(
    private readonly newsService: NewsService,
    private readonly authService: AuthService,
    private readonly destinationRiskService: DestinationRiskService,
    private readonly sheltersService: SheltersService,
    private readonly disasterService: DisasterService,
  ) {}

  async serveMain(clientId: string) {
    let latitude: number;
    let longitude: number;

    if (_.isNil(clientId)) return;

    // 위도 경도 뽑아내기(없다면 서울 시청 기준)(클라이언트 테이블 조회)
    if (clientId !== 'none') {
      const client = await this.authService.findClientByClientId(clientId);
      latitude = client.latitude || 37.566779160550716;
      longitude = client.longitude || 126.97869471811414;
    } else {
      latitude = 37.566779160550716;
      longitude = 126.97869471811414;
    }

    return await this.getSummary(longitude, latitude);
  }

  async serveSearch(destination: string) {
    const { longitude, latitude } =
      await this.destinationRiskService.getCoordinate(destination);

    return { ...(await this.getSummary(longitude, latitude)), isSearch: true };
  }

  private async getSummary(longitude: number, latitude: number) {
    let score = 0;
    const keywords = disasterKeywords;

    // 나의 현재 위치명 받기
    const location = await this.destinationRiskService.getAreaCoordinates(
      longitude,
      latitude,
    );

    // 재난 메세지 지역명 받기
    const regionName = await this.destinationRiskService.getRegionCoordinates(
      longitude,
      latitude,
    );

    // 재난 현황(오늘 날짜)
    const disaster = await this.disasterService.findTodayDisaster();
    const responseDisaster = disaster.filter((data) => {
      const isMyRegion = data.locationName.includes(regionName);
      if (isMyRegion) {
        return keywords.some((keyword) => data.message.includes(keyword));
      }
    });

    // 서울이 아닌 경우 재난 현황만 제공
    if (!location.includes('서울')) {
      return {
        isNotSeoul: true,
        location,
        responseDisaster,
      };
    }

    const realTimeDestinationRisk =
      await this.destinationRiskService.checkDestinationRisk({
        longitude,
        latitude,
      });

    const realTimeData = {
      realTimeCongestion: realTimeDestinationRisk['실시간 장소 혼잡도'],
      expectedPopulation: realTimeDestinationRisk['예상 인구'],
      standardTime: realTimeDestinationRisk['기준 시간'],
    };

    // 내 위치에서 가장 가까운 대피소
    const shelterInfo = await this.sheltersService.closeToShelter(
      longitude,
      latitude,
    );
    const shelter =
      !_.isNil(shelterInfo) && !_.isNil(shelterInfo.facility_name)
        ? shelterInfo.facility_name
        : '가까운 대피소정보가 없습니다. 빠른 시일내에 업데이트 하겠습니다.';

    // 사건 사고
    const news = await this.newsService.findAccidentNews();

    // 점수 매기기
    switch (realTimeDestinationRisk['실시간 장소 혼잡도']) {
      case '여유':
        score += 1;
        break;
      case '보통':
        score += 1;
        break;
      case '약간 붐빔':
        score += 2;
        break;
      case '붐빔':
        score += 3;
        break;
    }

    if (news.length >= 5) {
      score += 3;
    } else if (news.length >= 3) {
      score += 2;
    } else if (news.length >= 1) {
      score += 1;
    }

    return {
      location,
      realTimeData,
      news,
      shelter,
      responseDisaster,
      score,
    };
  }
}
