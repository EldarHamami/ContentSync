// Values below are taken from real camera sidecar files (FX3, A7S III and sibling Sony bodies).
export function sidecar(o: {
  duration: number;
  tcFps: number;
  halfStep?: boolean;
  start: string;
  end?: string;
  created: string;
  fps: string;
  captureFps?: string;
  model?: string;
  mode?: string;
  umidTail?: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NonRealTimeMeta xmlns="urn:schemas-professionalDisc:nonRealTimeMeta:ver.2.20" xmlns:lib="urn:schemas-professionalDisc:lib:ver.2.10" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" lastUpdate="${o.created}">
	<TargetMaterial umidRef="060A2B340101010501010D4313000000624C96BF269905C3${o.umidTail ?? 'C4AC59FFFEA88E27'}"/>
	<Duration value="${o.duration}"/>
	<LtcChangeTable tcFps="${o.tcFps}" halfStep="${o.halfStep ? 'true' : 'false'}">
		<LtcChange frameCount="0" value="${o.start}" status="increment"/>
		<LtcChange frameCount="${o.duration - 1}" value="${o.end ?? o.start}" status="end"/>
	</LtcChangeTable>
	<CreationDate value="${o.created}"/>
	<KlvPacketTable>
		<KlvPacket key="060E2B34010101050301020A02000000" frameCount="0" lengthValue="095F5265635374617274" status="spot"/>
	</KlvPacketTable>
	<VideoFormat>
		<VideoRecPort port="DIRECT"/>
		<VideoFrame videoCodec="AVC_3840_2160_HP@L52" captureFps="${o.captureFps ?? o.fps}" formatFps="${o.fps}"/>
		<VideoLayout pixel="3840" numOfVerticalLine="2160" aspectRatio="16:9"/>
	</VideoFormat>
	<AudioFormat numOfChannel="2">
		<AudioRecPort port="DIRECT" audioCodec="LPCM16" trackDst="CH1"/>
		<AudioRecPort port="DIRECT" audioCodec="LPCM16" trackDst="CH2"/>
	</AudioFormat>
	<Device manufacturer="Sony" modelName="${o.model ?? 'ILME-FX3'}" serialNo="4294967295"/>
	<RecordingMode type="${o.mode ?? 'normal'}" cacheRec="false"/>
</NonRealTimeMeta>`;
}

export const REAL = {
  fx3_5994: { duration: 4500, tcFps: 30, halfStep: true, start: '43114805', end: '44A64905', created: '2022-12-13T15:48:35+08:00', fps: '59.94p' },
  a7s3_5994: { duration: 4740, tcFps: 30, halfStep: true, start: '56231809', end: '57C21909', created: '2022-12-13T15:48:58+08:00', fps: '59.94p', model: 'ILCE-7SM3' },
  fx3_2398: { duration: 816, tcFps: 24, start: '00535300', end: '23265400', created: '2025-02-05T17:11:22+01:00', fps: '23.98p' },
  a7m3_120: { duration: 1440, tcFps: 30, halfStep: true, start: '45002101', end: '44922101', created: '2020-12-29T19:01:18-05:00', fps: '119.88p' },
  a7m3_50: { duration: 96, tcFps: 25, halfStep: true, start: '15570212', end: '12590292', created: '2023-06-14T14:29:07+11:00', fps: '50p' },
  zve10_25: { duration: 3012, tcFps: 25, start: '08333005', end: '19333205', created: '2025-10-17T13:56:48+01:00', fps: '25p' },
  a7r3_2997: { duration: 525, tcFps: 30, start: '59041204', end: '43221204', created: '2023-12-30T04:59:18+08:00', fps: '29.97p' },
  rx10_sq: { duration: 1770, tcFps: 30, start: '40124900', end: '69105000', created: '2024-08-06T16:39:06-05:00', fps: '29.97p', captureFps: '479.52p', mode: 'slowAndQuickMotion' },
};
