import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import convert from 'xml-js'

@Injectable()
export class DestinationRiskService {
    constructor (
        private configService: ConfigService,
    ) {}

    async getDestinationRisk (destination : string) {
        const seoulRealTimeData = await this.configService.get('REAL_TIME_DATA_API')
        const response = await axios.get(`http://openapi.seoul.go.kr:8088/${seoulRealTimeData}/xml/citydata/1/1/${destination}`)
        const xmlData = response.data
        const xmlToJsonData = convert.xml2json(xmlData, {
            compact : true,
            spaces : 4
        })
        const realTimeDataJsonVer = JSON.parse(xmlToJsonData)
        const areaName = realTimeDataJsonVer['SeoulRtd.citydata']['CITYDATA']['AREA_NM']['_text']
        const areaCongestLvlMsg = realTimeDataJsonVer['SeoulRtd.citydata']['CITYDATA']['LIVE_PPLTN_STTS']['LIVE_PPLTN_STTS']
        const realTimeDestinationRiskData = {
             '목적지' : areaName,
             '장소 혼잡도' : areaCongestLvlMsg.AREA_CONGEST_LVL._text,
             '관련 안내사항' : areaCongestLvlMsg.AREA_CONGEST_MSG._text
        }
        return realTimeDestinationRiskData
    }
}
