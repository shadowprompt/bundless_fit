const fs = require('fs');
const xml2js = require('xml2js');
const converter = require('json-2-csv');
const { exec } = require('child_process');
const path = require("path");
const axios = require('axios');
const { dLog, nodeStore } = require('@daozhao/utils');
const localStorage = nodeStore('../localStorage/bundless_fit');

const gpsTransformer = require('./gpsTransformer');
const {makeZip, sendMail} = require("./mail");
const {getTcxSportType, getFitSportType} = require("./config");

const FIT_EPOCH_MS = 631065600000; // fit格式时间与标准时间戳的差值

let fileCreatedCount = 0;
// 任务锁
const LOCK_FILE_PATH = path.join(__dirname, './job.lock');

function releaseLock() {
    if (checkLock()) {
        fs.rmSync(LOCK_FILE_PATH);
    }
}

function setLock(str = '1') {
    fs.writeFileSync(LOCK_FILE_PATH, str);
}

function checkLock() {
    return fs.existsSync(LOCK_FILE_PATH)
}
// 不转换坐标，仅以类似格式返回
function justReturnPosition(LongitudeDegrees, LatitudeDegrees) {
    return [LongitudeDegrees, LatitudeDegrees];
}

function mkdirsSync(dirname) {
    if (fs.existsSync(dirname)) {
        return true;
    } else {
        if (mkdirsSync(path.dirname(dirname))) {
            fs.mkdirSync(dirname);
            return true;
        }
    }
}

function getSummaryFromList(list) {
    const max =  list.reduce((acc, [, value]) => Math.max(acc, value), -Infinity);
    const min =  list.reduce((acc, [, value]) => Math.min(acc, value), Infinity);
    const total =  list.reduce((acc, [, value]) => acc + value * 1, 0);
    const avg = list.length > 0 ? (total / list.length).toFixed(3) : 0;
    return {
        min: [NaN, -Infinity, Infinity].includes(min) ? 0 : min,
        max: [NaN, -Infinity, Infinity].includes(max) ? 0 : max,
        total: [NaN, -Infinity, Infinity].includes(total) ? 0 : total,
        avg: [NaN, -Infinity, Infinity].includes(avg) ? 0 : avg,
    }
}

function runDirs(basePath, info, callback) {
    const jsonDirPath = basePath + '/json';
    let fileList = fs.readdirSync(jsonDirPath);
    fileList = fileList.filter(item => /\.json$/.test(item));

    fileCreatedCount = 0;

    // 改用任务队列，新生成任务，一个任务成功了再执行下一个任务
    const jobQueue = [];

    fileList.forEach((item) => {
        jobQueue.push(makeTCX(basePath, info, item, fileList.length));
        jobQueue.push(makeFIT(basePath, info, item, fileList.length));
    });

    function runJob() {
        const len = jobQueue.length;
        if (len > 0) {
            const job = jobQueue.shift();
            job().then(() => {
                runJob();
            }).catch(err => {
                dLog(`jobQueue error, remain ${len - 1}`,err);
            })
        } else {
            dLog('jobQueue empty');
            callback();
        }
    }

    runJob();
}

function makeTCX(basePath, info, jsonFileName, totalLength) {
    return () => {
        // 统一按类json同名文件命名
        const commonFileName = jsonFileName.replace(/\.json$/, '').replace(/\s+/, '_');

        let data = fs.readFileSync(`${basePath}/json/${jsonFileName}`);
        data = JSON.parse(data.toString())
        const { trackList = [], simplifyValue, address, startTs } = data;

        const utcTime = new Date(startTs).toISOString();
        // 兜底generic
        const sportTypeStr = getTcxSportType(simplifyValue.sportType);

        const obj = {
            'TrainingCenterDatabase': {
                $: {
                    'xsi:schemaLocation': "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd",
                    'xmlns:ns5': "http://www.garmin.com/xmlschemas/ActivityGoals/v1",
                    'xmlns:ns3': "http://www.garmin.com/xmlschemas/ActivityExtension/v2",
                    'xmlns:ns2': "http://www.garmin.com/xmlschemas/UserProfile/v2",
                    'xmlns': "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2",
                    'xmlns:xsi': "http://www.w3.org/2001/XMLSchema-instance",
                    'xmlns:ns4': "http://www.garmin.com/xmlschemas/ProfileExtension/v1",
                    'xmlns:xsd': "http://www.w3.org/2001/XMLSchema"
                },
                Activities: {
                    Activity: {
                        $: {
                            Sport: sportTypeStr,
                        },
                        Id: utcTime,
                        Lap: {
                            $: {
                                StartTime: utcTime,
                            },
                            TotalTimeSeconds: simplifyValue.totalTime/1000,
                            DistanceMeters: simplifyValue.totalDistance,
                            MaximumSpeed: simplifyValue.bestPace,
                            Calories: simplifyValue.totalCalories/1000,
                            AverageHeartRateBpm: {
                                $: {
                                    'xsi:type': 'HeartRateInBeatsPerMinute_t'
                                },
                                Value: simplifyValue.avgHeartRate,
                            },
                            MaximumHeartRateBpm: {
                                $: {
                                    'xsi:type': 'HeartRateInBeatsPerMinute_t'
                                },
                                Value: simplifyValue.maxHeartRate,
                            },
                            TriggerMethod: 'Time',
                            Track: {
                                Trackpoint: trackList.map(item => {
                                    // 加入gcj02坐标系转换为wgs84
                                    if (item.Position && item.Position.positionType) {
                                        const transformer = item.Position.positionType === 'GCJ02' ? gpsTransformer.gcj02towgs84 : justReturnPosition;
                                        const [LongitudeDegrees, LatitudeDegrees] = transformer(item.Position.LongitudeDegrees, item.Position.LatitudeDegrees);
                                        return {
                                            ...item,
                                            Position: {
                                                LongitudeDegrees,
                                                LatitudeDegrees,
                                            }
                                        }
                                    } else {
                                        return item;
                                    }
                                }),
                            },
                        }
                    }
                }
            }
        }
        return new Promise(resolve => {
            const builder = new xml2js.Builder();
            const xml = builder.buildObject(obj);

            // 按照不同sportType存储
            mkdirsSync(`${basePath}/tcx/${simplifyValue.sportType}`);
            fs.writeFileSync(`${basePath}/tcx/${simplifyValue.sportType}/${commonFileName}.tcx`, xml);
            fileCreatedCount = fileCreatedCount + 1
            dLog('tcx success', commonFileName, simplifyValue.sportType, address, `${fileCreatedCount}/${totalLength}`);
            resolve('tcx');
        });
    }
}

function makeFIT(basePath, info, jsonFileName, totalLength) {
    return () => {
        // 统一按类json同名文件命名
        const commonFileName = jsonFileName.replace(/\.json$/, '').replace(/\s+/, '_');

        let data = fs.readFileSync(`${basePath}/json/${jsonFileName}`);
        data = JSON.parse(data.toString())
        const { trackList = [], simplifyValue, address, _source, startTs } = data;

        const startTimeTs = startTs;
        const startTimeFit = parseInt((startTimeTs - FIT_EPOCH_MS) / 1000);
        const totalTimeSeconds = parseInt(simplifyValue.totalTime/ 1000);
        const endTimeFit = parseInt((startTimeTs + simplifyValue.totalTime - FIT_EPOCH_MS) / 1000);
        // 步频
        const cadenceList = trackList.filter(item => item.Cadence).map(item => [1, item.Cadence]);
        const cadenceSummary = getSummaryFromList(cadenceList);
        // 根据距离、步频、时间推算出步幅
        const stepLengthAvg = cadenceSummary.avg === 0 ? 0 : parseInt(simplifyValue.totalDistance / ((cadenceSummary.avg*2/60) * totalTimeSeconds) * 1000);
        // 心率 simplifyValue自带可直接使用
        const heartRateList = trackList.filter(item => item.HeartRateBpm).map(item => [1, item.HeartRateBpm]);
        const heartRateSummary = getSummaryFromList(heartRateList);
        // 配速
        const speedList = trackList.filter(item => item._speed).map(item => [1, item._speed / 10]);
        const speedSummary = getSummaryFromList(speedList);
        speedSummary.avg = (simplifyValue.totalDistance/totalTimeSeconds).toFixed(3);
        // 跳绳速度
        const jumpRateList = trackList.filter(item => item._jumpRate).map(item => [1, item._jumpRate * 1]);
        const jumpRateSummary = getSummaryFromList(jumpRateList);
        // 高度
        const altitudeList = trackList.filter(item => item.AltitudeMeters).map(item => [1, item.AltitudeMeters * 1]);
        const altitudeSummary = getSummaryFromList(altitudeList);
        // 兜底generic
        const [sportType, subSportType, sportName] = getFitSportType(simplifyValue.sportType, info);


        const fieldList = ['Field', 'Value', 'Units'];
        const keyList = ['Type', 'Local Number', 'Message'].concat(...Array(35).fill(1).map((_, index) => {
            const num = index + 1;
            return fieldList.map(item => item ? (item + ' ' + num) : '')
        }))

        function gen(list) {
            return list.reduce((acc, [field, value, units = ''], index) => {
                const idx = index * 3;
                return {
                    ...acc,
                    [keyList[idx ]]: field,
                    [keyList[idx + 1]]: value,
                    [keyList[idx + 2]]: units,
                }
            }, {})
        }

        function getRecord(item, timeFit) {
            const eachList = [
                ['Data', 0, 'record'],
                ['timestamp', timeFit, 's'],
                ['activity_type', sportType, '']
            ];

            if (item.Position) {
                // 加入gcj02坐标系转换为wgs84
                const transformer = item.Position.positionType === 'GCJ02' ? gpsTransformer.gcj02towgs84 : justReturnPosition;
                const [LongitudeDegrees, LatitudeDegrees] = transformer(item.Position.LongitudeDegrees, item.Position.LatitudeDegrees);
                eachList.push(
                  ['position_lat', parseInt(LatitudeDegrees * ( Math.pow(2, 31) / 180 )), 'semicircles'],
                  ['position_long', parseInt(LongitudeDegrees * ( Math.pow(2, 31) / 180 )), 'semicircles'],
                )
            }
            // 海拔
            if (item.AltitudeMeters) {
                eachList.push(
                  ['altitude', (item.AltitudeMeters * 1).toFixed(3), 'm']
                )
            }
            // 心率
            if (item.HeartRateBpm) {
                eachList.push(
                  ['heart_rate', item.HeartRateBpm.Value * 1, 'bpm']
                )
            }
            // 步频
            if (item.Cadence) {
                eachList.push(
                  ['cadence', item.Cadence, 'rpm']
                )
            }
            // 速度
            if (item._speed) {
                eachList.push(
                  ['speed', (item._speed/10).toFixed(3), 'm/s']
                )
            }
            // 跳绳速度
            if (item._jumpRate) {
                eachList.push(
                  ['jump_rate', item._jumpRate, 'jpm']
                )
            }

            return {
                definition: eachList.map((item, index) => {
                    if (index === 0) {
                        return ['Definition', ...item.slice(1)];
                    } else {
                        return [item[0], 1];
                    }
                }),
                data: eachList,
            }
        }

        const infoList = [];
        infoList.push(
          gen([['Definition', 0, 'file_id'], ['type', 1], ['manufacturer', 1], ['time_created', 1], ['product', 1], ['product_name', 1]]),
          gen([['Data', 0, 'file_id'], ['type', 4], ['manufacturer', 294], ['time_created', startTimeFit], ['product', 802], ['product_name', 'Huawei band 7']]),
          gen([['Definition', 0, 'activity'], ['timestamp', 1], ['total_timer_time', 1], ['local_timestamp', 1], ['num_sessions', 1], ['type', 1], ['event', 1], ['event_type', 1]]),
          gen([['Data', 0, 'activity'], ['timestamp', startTimeFit, 's'], ['total_timer_time', simplifyValue.totalTime, 's'], ['local_timestamp', startTimeFit + 28800], ['num_sessions', 1], ['type', 0], ['event', 16], ['event_type', 1]]),
          gen([['Definition', 0, 'event'], ['timestamp', 1], ['event', 1], ['event_type', 1], ['event_group', 1]]),
          gen([['Data', 0, 'event'], ['timestamp', startTimeFit, 's'], ['event', 0], ['event_type', 0], ['event_group', 0]]), // 开始
        );

        if (simplifyValue.sportType === 283 && _source === 'huawei') {
            infoList.push(
              gen([
                    ['Data', 0, 'sport'],
                    ['name', sportName],
                    ['sport', sportType],
                    ['sub_sport', subSportType],
                ]
              )
            );

            infoList.push(
              gen([
                    ['Definition', 0, 'device_info'],
                    ['timestamp', 1],
                    ['serial_number', 1],
                    ['cum_operating_time', 1],
                    ['manufacturer', 1],
                    ['product', 1],
                    ['software_version', 1],
                    ['device_index', 1],
                    ['device_type', 1],
                    ['source_type', 1],
                ]
              )
            );
            infoList.push(
              gen([
                    ['Data', 0, 'device_info'],
                    ['timestamp', endTimeFit],
                    ['serial_number', 3425706245],
                    ['manufacturer', 1],
                    ['garmin_product', 3990],
                    ['software_version', 17.26],
                    ['device_index', 0],
                    ['source_type', 5],
                ]
              )
            );
            infoList.push(
              gen([
                    ['Data', 0, 'device_info'],
                    ['timestamp', endTimeFit],
                    ['manufacturer', 1],
                    ['garmin_product', 3990],
                    ['software_version', 17.26],
                    ['local_device_type', 4],
                    ['device_index', 1],
                    ['source_type', 5],
                ]
              )
            );
            infoList.push(
              gen([
                    ['Data', 0, 'device_info'],
                    ['timestamp', endTimeFit],
                    ['local_device_type', 8],
                    ['device_index', 2],
                    ['source_type', 5],
                ]
              )
            );
            infoList.push(
              gen([
                    ['Data', 0, 'device_info'],
                    ['timestamp', endTimeFit],
                    ['software_version', 0.06],
                    ['local_device_type', 10],
                    ['device_index', 3],
                    ['source_type', 5],
                ]
              )
            );
            infoList.push(
              gen([
                    ['Data', 0, 'device_info'],
                    ['timestamp', endTimeFit],
                    ['manufacturer', 1],
                    ['garmin_product', 3995],
                    ['software_version', 17.16],
                    ['local_device_type', 12],
                    ['device_index', 4],
                    ['source_type', 5],
                ]
              )
            );

            infoList.push(
              gen([
                    ['Definition', 0, 'developer_data_id'],
                    ['developer_id', 16],
                    ['application_id', 16],
                    ['application_version', 1],
                    ['manufacturer_id', 1],
                    ['developer_data_index', 1],
                ]
              )
            );
            infoList.push(
              gen([
                    ['Data', 0, 'developer_data_id'],
                    ['application_id', '202|176|1|181|3|76|74|207|133|114|202|100|8|0|183|162'],
                    ['application_version', 15],
                    ['developer_data_index', 0],
                ]
              )
            );

            infoList.push(
              gen([
                  ['Data', 0, 'field_description'],
                  ['field_name', 'jump_rate', ''],
                  ['units', 'jpm', ''],
                  ['native_mesg_num', 20],
                  ['developer_data_index', 0],
                  ['field_definition_number', 8],
                  ['fit_base_type_id', 132],
              ]),
              gen([
                  ['Data', 0, 'field_description'],
                  ['field_name', 'session_speed', ''],
                  ['units', 'jpm', ''],
                  ['native_mesg_num', 20],
                  ['developer_data_index', 0],
                  ['field_definition_number', 12],
                  ['fit_base_type_id', 132],
              ]),
            );
        }


        let lastDefinition = [];
        trackList.forEach((item, index) => {
            const timeTs = new Date(item.Time).getTime();
            const timeFit = parseInt((timeTs - FIT_EPOCH_MS) / 1000);
            if (index === 0) {
                infoList.push(
                  gen([['Definition', 0, 'record'], ['timestamp', 1], ['distance', 1], ['activity_type', 1]]),
                  gen([['Data', 0, 'record'], ['timestamp', timeFit, 's'], ['distance', 0, 'm'], ['activity_type', sportType]]),
                )
            }

            const info = getRecord(item, timeFit);

            const currentDefinition = info.definition.map(item => item[0]);
            if (lastDefinition.join('|') !== currentDefinition.join('|')) {
                infoList.push(gen(info.definition));
            }
            lastDefinition = [...currentDefinition];

            infoList.push(gen(info.data));
        })

        infoList.push(
          gen([['Definition', 0, 'event'], ['timestamp', 1], ['event', 1], ['event_type', 1], ['event_group', 1]]),
          gen([['Data', 0, 'event'], ['timestamp', endTimeFit, 's'], ['event', 0], ['event_type', 4], ['event_group', 0]]), // 结束
        )

        const lengthList = [];

        if (sportType === 5) {
            if (_source === 'xiaomi') {
              const _avgCircleCount = simplifyValue.totalDistance/simplifyValue.pool_width;
              const avgCircleCount = Math.ceil(_avgCircleCount);
              // 平均每个circle的strokes
              const _avgStrokes = simplifyValue.stroke_count/_avgCircleCount;
              const avgStrokes = Math.ceil(_avgStrokes);
              // 最后一个circle的strokes根据区分是否有半圈区分
              const lastCircleStrokes = avgCircleCount > _avgCircleCount ? simplifyValue.stroke_count - avgStrokes * Math.round(avgCircleCount) : avgStrokes;

              const totalElapsedTimeFit = endTimeFit - startTimeFit;
              // 平均每个circle的耗时
              const avgElapsedTimeFit =  Math.round(totalElapsedTimeFit/_avgCircleCount);

              let lastStartTimeFit = startTimeFit;
              lengthList.push(
                gen([['Definition', 0, 'length'], ['timestamp', 1], ['start_time', 1], ['total_elapsed_time',	1],	['total_timer_time', 1],['total_strokes',	1]]),
              )

              for(let i = 1;i<=avgCircleCount;i++) {
                // 最后一个circle
                if (i === avgCircleCount) {
                  lengthList.push(
                    gen([['Data', 0, 'length'], ['timestamp', endTimeFit, 's'], ['start_time', lastStartTimeFit, 's'], ['total_elapsed_time',  endTimeFit - lastStartTimeFit, 's'], ['total_timer_time', endTimeFit - lastStartTimeFit, 's'], ['total_strokes', lastCircleStrokes,	'strokes']]),
                  )
                } else {
                  // 其它的都取平均值
                  lengthList.push(
                    gen([['Data', 0, 'length'], ['timestamp', lastStartTimeFit + avgElapsedTimeFit, 's'], ['start_time', lastStartTimeFit, 's'], ['total_elapsed_time',  avgElapsedTimeFit, 's'], ['total_timer_time', avgElapsedTimeFit, 's'], ['total_strokes', avgStrokes,	'strokes']]),
                  )
                  lastStartTimeFit = lastStartTimeFit + avgElapsedTimeFit;
                }
              }
            } else if (_source === 'huawei') {
              let lastStartTimeFit = startTimeFit;
              lengthList.push(
                gen([
                  ['Definition', 0, 'length'],
                  ['timestamp', 1],
                  ['start_time', 1],
                  ['total_elapsed_time', 1],
                  ['total_timer_time', 1],
                  ['total_strokes',	1],
                  ['swim_stroke',	1],
                  ['avg_swimming_cadence', 1],
                  ['avg_speed',	1],
                  ['message_index', 1],
                ]),
              )

              const mSwimSegments = simplifyValue.mSwimSegments || [];

              mSwimSegments.forEach((item, index) => {
                const startTs = lastStartTimeFit * 1000 + FIT_EPOCH_MS;
                const endTs = startTs + item.mDuration * 1000;
                const currentLengthTrackList = trackList.filter(it => {
                  const ts = new Date(it.Time).getTime();
                  return startTs >= ts && ts < endTs;
                });
                const currentLengthHeartRateTrackList = currentLengthTrackList.filter(item => item.HeartRateBpm && item.HeartRateBpm.Value).map(item => [1, item.HeartRateBpm.Value * 1]);
                const currentLengthHeartRateSummary = getSummaryFromList(currentLengthHeartRateTrackList);
                lengthList.push(
                  gen([
                    ['Data', 0, 'length'],
                    ['timestamp', lastStartTimeFit + item.mDuration * 1000],
                    ['start_time', lastStartTimeFit],
                    ['total_elapsed_time',  item.mDuration, 's'],
                    ['total_timer_time', item.mDuration, 's'],
                    ['total_strokes', item.mPullTimes,	'strokes'],
                    ['swim_stroke',	item.mStrokeType, 'swim_stroke'],
                    ['avg_swimming_cadence', item.mDistance,	'strokes/min'],
                    ['avg_speed',	parseInt(item.mPace/100).toFixed(2), 'm/s'],
                    ['message_index',	index],
                  ]),
                )
                lastStartTimeFit = lastStartTimeFit + item.mDuration * 1000;
              })
            }
        }

        if (simplifyValue.sportType === 283 && _source === 'huawei') {
            infoList.push(
              gen([
                    ['Definition', 0, 'sport'],
                    ['name', 128],
                    ['sport', 1],
                    ['sub_sport', 1],
                ]
              )
            );

            infoList.push(
              gen([
                  ['Definition', 0, 'field_description'],
                  ['field_name', 64, ''],
                  ['units', 16, ''],
              ]),
              gen([
                  ['Data', 0, 'field_description'],
                  ['field_name', 'jump_mode', ''],
                  ['units', 'mode', ''],
                  ['native_mesg_num', 18],
                  ['developer_data_index', 0],
                  ['field_definition_number', 1],
                  ['fit_base_type_id', 7],
              ]),
              gen([
                  ['Data', 0, 'field_description'],
                  ['field_name', 'total_time', ''],
                  ['units', 'mm:ss', ''],
                  ['native_mesg_num', 18],
                  ['developer_data_index', 0],
                  ['field_definition_number', 2],
                  ['fit_base_type_id', 7],
              ]),
              gen([
                  ['Data', 0, 'field_description'],
                  ['field_name', 'active_time', ''],
                  ['units', 'mm:ss', ''],
                  ['native_mesg_num', 18],
                  ['developer_data_index', 0],
                  ['field_definition_number', 3],
                  ['fit_base_type_id', 7],
              ]),
              gen([
                  ['Data', 0, 'field_description'],
                  ['field_name', 'reps', ''],
                  ['units', 'reps', ''],
                  ['native_mesg_num', 18],
                  ['developer_data_index', 0],
                  ['field_definition_number', 4],
                  ['fit_base_type_id', 132],
              ]),
              gen([
                  ['Data', 0, 'field_description'],
                  ['field_name', 'rounds', ''],
                  ['units', 'rounds', ''],
                  ['native_mesg_num', 18],
                  ['developer_data_index', 0],
                  ['field_definition_number', 5],
                  ['fit_base_type_id', 132],
              ]),
              gen([
                  ['Data', 0, 'field_description'],
                  ['field_name', 'average_reps', ''],
                  ['units', 'reps', ''],
                  ['native_mesg_num', 18],
                  ['developer_data_index', 0],
                  ['field_definition_number', 6],
                  ['fit_base_type_id', 132],
              ]),
              gen([
                  ['Data', 0, 'field_description'],
                  ['field_name', 'Max_streaks', ''],
                  ['units', 'times', ''],
                  ['native_mesg_num', 18],
                  ['developer_data_index', 0],
                  ['field_definition_number', 7],
                  ['fit_base_type_id', 132],
              ]),
              gen([
                  ['Data', 0, 'field_description'],
                  ['field_name', 'max_jump_rate', ''],
                  ['units', 'jpm', ''],
                  ['native_mesg_num', 18],
                  ['developer_data_index', 0],
                  ['field_definition_number', 8],
                  ['fit_base_type_id', 132],
              ]),
              gen([
                  ['Data', 0, 'field_description'],
                  ['field_name', 'total_calories', ''],
                  ['units', 'kcal', ''],
                  ['native_mesg_num', 18],
                  ['developer_data_index', 0],
                  ['field_definition_number', 9],
                  ['fit_base_type_id', 132],
              ]),
              gen([
                  ['Data', 0, 'field_description'],
                  ['field_name', 'app_version', ''],
                  ['units', 'ver', ''],
                  ['native_mesg_num', 18],
                  ['developer_data_index', 0],
                  ['field_definition_number', 10],
                  ['fit_base_type_id', 7],
              ]),
            )
        }

        if (lengthList.length > 0) {
            infoList.push(...lengthList);
        }

        const paceMap = simplifyValue.paceMap || {};
        // 计圈信息
        const lapList = [];
        Object.keys(paceMap).sort((a, b) => a - b).reduce(([lastPointIndex, lastDistance], item) => {
            const kmNum = (item/10000000).toFixed(2) * 10000000;
            const pointIndex = item - kmNum;
            const distance = item - pointIndex;
            const lapDistance = (distance - lastDistance)/10000;

            const lapTrackList = trackList.filter(item => item._pointIndex >= lastPointIndex && item._pointIndex < pointIndex);
            if (lapTrackList.length > 0) {
                lapList.push([lapTrackList, lapDistance]);
            }
            return [pointIndex, distance];
        }, [0, 0]);

        if (lapList.length > 0) { // 有配速信息，可将每公里作为一圈
            // start_time、timestamp 分别对应起始时间
            // total_timer_time和total_elapsed_time的值相同
            // 步频
            // 心率
            // 配速
            infoList.push(
              gen([
                  ['Definition', 0, 'lap'],
                  ['timestamp', 1],
                  ['start_time', 1],
                  ['total_timer_time', 1],
                  ['total_elapsed_time', 1],
                  ['total_distance', 1],
                  ['max_cadence', 1],
                  ['avg_cadence', 1],
                  ['avg_step_length', 1],
                  ['max_heart_rate', 1],
                  ['min_heart_rate', 1],
                  ['avg_heart_rate', 1],
                  ['max_speed', 1],
                  ['avg_speed', 1],
                  ['max_altitude', 1],
                  ['min_altitude', 1],
                  ['avg_altitude', 1],
                  ['first_length_index', 1],
                  ['num_lengths', 1],
              ]),
            )
            lapList.forEach(([lapTrackList, lapTotalDistance], idx) => {
                const startTrack = lapTrackList[0];
                const endTrack = lapTrackList[lapTrackList.length - 1];

                const lapStartTimeTs = new Date(startTrack.Time).getTime();
                const lapEndTimeTs = new Date(endTrack.Time).getTime();
                const lapStartTimeFit =  parseInt((lapStartTimeTs - FIT_EPOCH_MS) / 1000);
                const lapEndTimeFit = parseInt((lapEndTimeTs - FIT_EPOCH_MS) / 1000);
                const elapsedTimeSeconds = lapEndTimeFit - lapStartTimeFit;

                const lapCadenceTrackList = lapTrackList.filter(item => item.Cadence).map(item => [1, item.Cadence * 1]);
                const lapCadenceSummary = getSummaryFromList(lapCadenceTrackList);

                const lapHeartRateTrackList = lapTrackList.filter(item => item.HeartRateBpm && item.HeartRateBpm.Value).map(item => [1, item.HeartRateBpm.Value * 1]);
                const lapHeartRateSummary = getSummaryFromList(lapHeartRateTrackList);

                const lapSpeedTrackList = lapTrackList.filter(item => item._speed).map(item => [1, item._speed / 10]);
                const lapSpeedSummary = getSummaryFromList(lapSpeedTrackList);
                lapSpeedSummary.avg = (lapTotalDistance/elapsedTimeSeconds).toFixed(3); // 平均配速应该根据距离除以时间，而不是求各个速度的平均值

                const lapAltitudeTrackList = lapTrackList.filter(item => item.AltitudeMeters).map(item => [1, item.AltitudeMeters * 1]);
                const lapAltitudeSummary = getSummaryFromList(lapAltitudeTrackList);

                const list = [
                    ['Data', 0, 'lap'],
                    ['timestamp', lapEndTimeFit, 's'],
                    ['start_time', lapStartTimeFit],
                    ['sport', sportType, ''],
                    ['total_timer_time', elapsedTimeSeconds, 's'],
                    ['total_elapsed_time', elapsedTimeSeconds, 's'],
                    ['total_distance', lapTotalDistance],
                ];
                // 可能有的 步频信息
                // 根据距离、步频、时间推算出步幅
                if (lapCadenceTrackList.length === 0) {
                    list.push(
                      ['max_cadence', '', 'rpm'],
                      ['avg_cadence', '', 'rpm'],
                      ['avg_step_length', '', 'mm'],
                    );
                } else {
                    const stepLengthAvg = lapCadenceSummary.avg === 0 ? 0 : parseInt(lapTotalDistance / ((lapCadenceSummary.avg * 2/60) * elapsedTimeSeconds) * 1000);
                    list.push(
                      ['max_cadence', lapCadenceSummary.max, 'rpm'],
                      ['avg_cadence', lapCadenceSummary.avg, 'rpm'],
                      ['avg_step_length', stepLengthAvg, 'mm'],
                    );
                }
                // 可能有的 心率信息
                if (lapHeartRateTrackList.length === 0) {
                    list.push(
                      ['max_heart_rate', '', 'bpm'],
                      ['min_heart_rate', '', 'bpm'],
                      ['avg_heart_rate', '', 'bpm'],
                    );
                } else {
                    list.push(
                      ['max_heart_rate', lapHeartRateSummary.max, 'bpm'],
                      ['min_heart_rate', lapHeartRateSummary.min, 'bpm'],
                      ['avg_heart_rate', lapHeartRateSummary.avg, 'bpm'],
                    );
                }
                // 可能有的 配速信息
                if (lapSpeedTrackList.length === 0) {
                    list.push(
                      ['max_speed', '', 'm/s'],
                      ['avg_speed', '', 'm/s'],
                    );
                } else {
                    list.push(
                      ['max_speed', (lapSpeedSummary.max * 1).toFixed(3), 'm/s'],
                      ['avg_speed', (lapSpeedSummary.avg * 1).toFixed(3), 'm/s'],
                    );
                }
                // 可能有的 高度信息
                if (lapAltitudeTrackList.length === 0) {
                    list.push(
                      ['max_altitude', '', 'm'],
                      ['min_altitude', '', 'm'],
                      ['avg_altitude', '', 'm'],
                    );
                } else {
                    list.push(
                      ['max_altitude', (lapAltitudeSummary.max * 1).toFixed(3), 'm'],
                      ['min_altitude', (lapAltitudeSummary.avg * 1).toFixed(3), 'm'],
                      ['avg_altitude', (lapAltitudeSummary.avg * 1).toFixed(3), 'm'],
                    );
                }

                list.push(
                  ['first_length_index', idx],
                  ['num_lengths', Math.max(lengthList.length - 1, 0)],
                )
                infoList.push(gen(list));
            })
        } else { // 无配速信息则全程数据作为一圈
            const lengKeyList = ['total_strokes', 1];
            const lengValueList = ['total_strokes', simplifyValue.stroke_count || 1, 'strokes'];
            infoList.push(
              gen([
                  ['Definition', 0, 'lap'],
                  ['timestamp', 1],
                  ['start_time', 1],
                  ['sport', 1],
                  ['total_timer_time', 1],
                  ['total_elapsed_time', 1],
                  ['total_distance', 1],
                  ['total_calories', 1],
                  ['max_cadence', 1],
                  ['avg_cadence', 1],
                  ['avg_step_length', 1],
                  ['max_heart_rate', 1],
                  ['min_heart_rate', 1],
                  ['avg_heart_rate', 1],
                  ['first_length_index', 1],
                  ['num_lengths', 1],
                  lengKeyList,
              ]),
              gen([
                  ['Data', 0, 'lap'],
                  ['timestamp', endTimeFit, 's'],
                  ['start_time', startTimeFit],
                  ['sport', sportType, ''],
                  ['total_timer_time', totalTimeSeconds, 's'],
                  ['total_elapsed_time', totalTimeSeconds, 's'],
                  ['total_distance', simplifyValue.totalDistance, 'm'],
                  ['total_calories', parseInt(simplifyValue.totalCalories / 1000), 'kcal'],
                  ['max_cadence', cadenceSummary.max, 'rpm'],
                  ['avg_cadence', cadenceSummary.avg, 'rpm'],
                  ['avg_step_length', stepLengthAvg, 'mm'],
                  ['max_heart_rate', simplifyValue.maxHeartRate, 'bpm'],
                  ['min_heart_rate', simplifyValue.minHeartRate, 'bpm'],
                  ['avg_heart_rate', simplifyValue.avgHeartRate, 'bpm'],
                  ['first_length_index', 0],
                  ['num_lengths', Math.max(lengthList.length - 1, 0)],
                  lengValueList,
              ])
            )
        }

        let poolLengthKeyList = [];
        let poolLengthValueList = [];

        if (sportType === 5) {
            if ( _source === 'xiaomi' ) {
                poolLengthKeyList = [['pool_length', 1]];
                poolLengthValueList = [['pool_length', simplifyValue.pool_width, 'm']];
            } else if (_source === 'huawei') {
                poolLengthKeyList = [['pool_length', 1]];
                poolLengthValueList = [['pool_length', simplifyValue.wearSportData.swim_pool_length / 100, 'm']];
            }
        }

        let jumpKeyList = [];
        let jumpValueList = [];

        if (simplifyValue.sportType === 283 && _source === 'huawei') {
            const data = simplifyValue.mExtendTrackDataMap || {};
            jumpKeyList = [
                ['jump_mode', 1],
                ['total_time', 1],
                ['active_time', 1],
                ['reps', 1],
                ['rounds', 1],
                ['average_reps', 1],
                ['Max_streaks', 1],
                ['max_jump_rate', 1],
                ['total_calories', 1],
                ['app_version', 1],
            ];
            jumpValueList = [
                ['jump_mode', 'Free'],
                ['total_time', formatSeconds(parseInt(simplifyValue.totalTime/1000)), 'mm:ss'], // 总时长
                ['active_time', formatSeconds(parseInt(simplifyValue.totalTime/1000)), 'mm:ss'], // 跳绳时长
                ['reps', data.skipNum, 'reps'], // 跳绳总次数
                ['rounds', data.stumblingRope, 'rounds'], // 回合数
                ['average_reps', parseInt(data.skipNum/data.stumblingRope), 'reps'], // 平均连跳次数/回合
                ['Max_streaks', data.maxSkippingTimes, 'times'], // 最多连续跳绳次数
                ['max_jump_rate', jumpRateSummary.max, 'jpm'], // 最大跳绳速度, 佳明可能显示成 速度
                ['total_calories', parseInt(simplifyValue.totalCalories/1000), 'kcal'],
                ['app_version', '1.0.0', 'ver'],
            ];
        }

        infoList.push(
          gen([
              ['Definition', 0, 'session'],
              ['timestamp', 1],
              ['start_time', 1],
              ['sport', 1],
              ['sub_sport', 1],
              ['total_elapsed_time', 1],
              ['total_timer_time', 1],
              ['total_distance', 1],
              ['total_calories', 1],
              ['max_cadence', 1],
              ['avg_cadence', 1],
              ['avg_step_length', 1],
              ['max_heart_rate', 1],
              ['min_heart_rate', 1],
              ['avg_heart_rate', 1],
              ['max_speed', 1],
              ['avg_speed', 1],
              ['max_altitude', 1],
              ['min_altitude', 1],
              ['avg_altitude', 1],
              ['sport_profile_name', 128],
              ...poolLengthKeyList,
            ...jumpKeyList,
          ]),
          gen([
              ['Data', 0, 'session'],
              ['timestamp', endTimeFit, 's'],
              ['start_time', startTimeFit],
              ['sport', sportType],
              ['sub_sport', subSportType],
              ['sport_profile_name', sportName],
              ['total_elapsed_time', totalTimeSeconds, 's'],
              ['total_timer_time', totalTimeSeconds, 's'],
              ['total_distance', simplifyValue.totalDistance, 'm'],
              ['total_calories', parseInt(simplifyValue.totalCalories / 1000), 'kcal'],
              ['max_cadence', cadenceSummary.max, 'rpm'],
              ['avg_cadence', cadenceSummary.avg, 'rpm'],
              ['avg_step_length', stepLengthAvg, 'mm'],
              ['max_heart_rate', simplifyValue.maxHeartRate, 'bpm'],
              ['min_heart_rate', simplifyValue.minHeartRate, 'bpm'],
              ['avg_heart_rate', simplifyValue.avgHeartRate, 'bpm'],
              ['max_speed', speedSummary.max, 'm/s'],
              ['avg_speed', speedSummary.avg, 'm/s'],
              ['max_altitude', altitudeSummary.max, 'm'],
              ['min_altitude', altitudeSummary.min, 'm'],
              ['avg_altitude', altitudeSummary.avg, 'm'],
              ...poolLengthValueList,
              ...jumpValueList,
          ]),
        )

        return new Promise((resolve) => {
          generateJson2Csv(infoList).then(result => {
            // 先写入csv文件，在使用jar完整 csv2fit
            fs.writeFileSync(`${basePath}/csv/${commonFileName}_${simplifyValue.sportType}.csv`, result);

            mkdirsSync(`${basePath}/fit/${simplifyValue.sportType}`);
            // 在腾讯云linux上java的路径和本机mac不同
            const javaPath = process.env.NODE_ENV === 'development' ? 'java' : '/usr/local/java/bin/java';
            const jarPath = path.join(__dirname, './FitCSVTool.jar')
            const command = `${javaPath} -jar ${jarPath} -c "${basePath}/csv/${commonFileName}_${simplifyValue.sportType}.csv"  "${basePath}/fit/${simplifyValue.sportType}/${commonFileName}.fit"`;
            // const command = `java -jar ${jarPath} -c "${basePath}/csv/${commonFileName}_${simplifyValue.sportType}.csv"  "${basePath}/fit/${simplifyValue.sportType}/${commonFileName}.fit"`;
            dLog('csv success', commonFileName, simplifyValue.sportType, address, `${fileCreatedCount}/${totalLength}`);

            exec(command, (error, stdout, stderr) => {
              if (!error && !stderr) {
                // 成功
                fileCreatedCount = fileCreatedCount + 1
                dLog('fit success', commonFileName, simplifyValue.sportType, address, `${fileCreatedCount}/${totalLength}`);
              } else {
                // 失败
                dLog('error', 'fit fail', command, fileCreatedCount, error);
                dLog('error', stderr);
              }
              resolve(command);
            });
          }).catch(err => {
            console.log('makeFIT err ~ ', err);
          });
        });
    };
}

/**
 * 将json转换成可供写入的csv格式内容
 * @param jsonData
 * @returns {Promise<string>}
 */
function generateJson2Csv(jsonData) {
  return new Promise((resolve) => {
    const data = converter.json2csv(jsonData,  {
      emptyFieldValue: '',
      excelBOM: true,
    });
    resolve(data);
  });
}

function pack(baseDir, info) {
    const { address, type, payment, paid, baseUrl, baseFilePath, fileName } = info;

    mkdirsSync(path.join(baseDir, 'csv'));
    mkdirsSync(path.join(baseDir, 'fit'));
    runDirs(baseDir, info, () => {
        packFiles();
        releaseLock();
    });

    function packFiles() {
        makeZip(baseDir + '/fit', `${baseFilePath}/${fileName}/fit.zip`)
            .then(() => makeZip(baseDir + '/tcx', `${baseFilePath}/${fileName}/tcx.zip`))
            .then(() => {
            const fitUrl = `${baseUrl}/fit.zip`;
            const tcxUrl = `${baseUrl}/tcx.zip`;

            dLog('log zip success', `[${address} ${type}] ${baseFilePath}/${fileName}/fit.zip and tcx.zip`);

            record({
                address,
                type,
                fileName,
                payment,
                paid,
                status: 'success',
                fileCreatedCount,
            });

            sendMail('qq', {
                from: "justnotify@qq.com",
                to: "jinicgood@qq.com", // 不再对外发送邮件
                subject: `${address} ${type} ${fileName} ${fileCreatedCount} 运动记录转换完成通知 https://www.fitconverter.com`,
                // text: "Plaintext version of the message",
                html: `您提交的运动记录已经成功转换成fit和tcx格式，结果文件已经准备好了，fit格式结果下载地址<a href="${fitUrl}" target="_blank">${fitUrl}</a>，tcx格式结果下载地址<a href="${tcxUrl}" target="_blank">${tcxUrl}</a>`,
            });
        }).catch(err => {
            dLog('zip error', err);
        })
    }
}

function recordToLocalStorage(recordInfo = {}, loc) {
    let prevList = localStorage.getItem('list') || '[]';
    prevList = JSON.parse(prevList);
    if (recordInfo.fileName) {
        const target = prevList.find(item => item.fileName === recordInfo.fileName);
        const ts = Date.now();
        if (target) {
            target.status = recordInfo.status;
            target.ts = ts;
            localStorage.setItem('list', JSON.stringify(prevList));
        } else {
            localStorage.setItem('list', JSON.stringify([
                ...prevList,
                {
                    ...recordInfo,
                    ts,
                }
            ]));
        }
    }
}

function recordToWeb(recordInfo) {
    const isTest = recordInfo.address && recordInfo.address ==='test';
    console.log('recordToWeb ~ ', recordInfo , 'isTest=',isTest);
    // address为test可视为调试，不更新记录
    if (!isTest) {
        axios.post('https://gateway.daozhao.com/convert/record', {
            list: [recordInfo],
        }).then(() => {
            dLog('log record', 'success', recordInfo.fileName);
        }).catch(err => {
            dLog('warn', 'log record', 'fail', recordInfo.fileName);
        });
    }
}

function record(recordInfo = {}, loc) {
    recordToWeb(recordInfo);
}

/**
 * 根据经纬度获取地址信息，以及是否在中国大陆
 * @param long
 * @param lan
 * @returns {Promise<axios.AxiosResponse<any> | {address: string}>}
 */
function fetchGeoInfo(long, lan) {
    const url = `https://restapi.amap.com/v3/geocode/regeo?location=${long},${lan}&key=5a7f82b0cb8399c45eff8a41df76e218`;
    return axios.get(url).then(res => {
        const data = res.data || {};
        if (data.status === '1') {
            const address = data.regeocode.formatted_address || '';
            const isInChinaMainland = /省|自治区|北京|天津|上海|重庆/.test(address);
            return {
                address,
                isInChinaMainland,
            }
        } else {
            return {
                address: '',
            };
        }
    }).catch(err => {
        return {
            address: '',
        };
    });
}

function formatSeconds(value) {
  let theTime = parseInt(value);// 秒
  let theTime1 = 0;// 分
  let theTime2 = 0;// 小时
  if (theTime > 60) {
    theTime1 = parseInt(theTime / 60);
    theTime = parseInt(theTime % 60);
    if (theTime1 > 60) {
      theTime2 = parseInt(theTime1 / 60);
      theTime1 = parseInt(theTime1 % 60);
    }
  }
  let result = "" + parseInt(theTime);
  if(result < 10){
    result = '0' + result;
  }
  if (theTime1 > 0) {
    result = "" + parseInt(theTime1) + ":" + result;
    if(theTime1 < 10){
      result = '0' + result;
    }
  }else{
    result = '00:' + result;
  }
  if (theTime2 > 0) {
    result = "" + parseInt(theTime2) + ":" + result;
    if(theTime2 < 10){
      result = '0' + result;
    }
  }else{
    result = '00:' + result;
  }
  return result;
}

module.exports = {
    setLock,
    releaseLock,
    checkLock,
    makeTCX,
    makeFIT,
    mkdirsSync,
    pack,
    record,
    fetchGeoInfo,
    formatSeconds,
}
