const fs = require('fs');
const xml2js = require('xml2js');
const converter = require('json-2-csv');
const { exec } = require('child_process');
const path = require("path");
const { dLog, nodeStore } = require('@daozhao/utils');
const localStorage = nodeStore('../localStorage/bundless_fit');

const gpsTransformer = require('./gpsTransformer');
const {makeZip, sendMail} = require("./mail");

const FIT_EPOCH_MS = 631065600000; // fit格式时间与标准时间戳的差值

let fileCreatedCount = 0;

// 从网上找到的零星数据，可能不全
const sportTypeTcxMap = {
    257: 'Walking', // 户外步行
    258: 'Running', // 户外跑步
    259: 'Biking', // 骑自行车
    264: 'Running', // Treadmill 室内跑步（跑步机）
    // 265: 'IndoorBike', // 室内骑自行车
    // 273: 'CrossTrainer ', // 椭圆机
    // 274: 'RowMachine', // 划船机
    // 290: 'Rower', // 划船机划水模式
    // 291: 'Rowerstrength', // 划船机力量模式
    279: 'MultiSport', // 其它运动 不好归类的都在此类
    // 281: 'Walking', // 室内步行
    // 283: 'RopeSkipping', // 跳绳
    // 129: 'Badminton', // 羽毛球
};

const sportTypeFitActivityTypeMap = {
    258: 1, // 跑步
    264: 1,
    259: 2, // 骑自行车
    265: 2,
    // 其它 0
};
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
    const max =  list.reduce((acc, [, value]) => Math.max(acc, value), 0);
    const min =  list.reduce((acc, [, value]) => Math.min(acc, value), Infinity);
    const total =  list.reduce((acc, [, value]) => acc + value * 1, 0);
    const avg = list.length > 0 ? parseInt(total / list.length) : 0;
    return {
        min,
        max,
        total,
        avg,
    }
}

function runDirs(basePath) {
    const jsonDirPath = basePath + '/json';
    let fileList = fs.readdirSync(jsonDirPath);
    fileList = fileList.filter(item => /\.json$/.test(item));

    fileCreatedCount = 0;

    fileList.forEach(async (item) => {
        await makeTCX(basePath, item, fileList.length);
        await makeFIT(basePath, item, fileList.length);
    });
}

function makeTCX(basePath, jsonFileName, totalLength) {
    // 统一按类json同名文件命名
    const commonFileName = jsonFileName.replace(/\.json$/, '').replace(/\s+/, '_');

    let data = fs.readFileSync(`${basePath}/json/${jsonFileName}`);
    data = JSON.parse(data.toString())
    const { trackList = [], simplifyValue } = data;

    if (trackList.length === 0) {
        return;
    }

    const utcTime = trackList[0].Time;
    // 兜底generic
    const sportTypeStr = sportTypeTcxMap[simplifyValue.sportType] || sportTypeTcxMap[259];

    const obj = {
        'TrainingCenterDatabase': {
            $: {
                'xsi:schemaLocation': "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd",
                version: "1.0",
                xmlns: "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2",
                'xmlns:xsi': "http://www.w3.org/2001/XMLSchema-instance",
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
                                    const transformer = item.Position.positionType === 'gcj02' ? gpsTransformer.gcj02towgs84 : justReturnPosition;
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

    const builder = new xml2js.Builder();
    const xml = builder.buildObject(obj);

    // 按照不同sportType存储
    mkdirsSync(`${basePath}/tcx/${simplifyValue.sportType}`);
    fs.writeFileSync(`${basePath}/tcx/${simplifyValue.sportType}/${commonFileName}.tcx`, xml);
    fileCreatedCount = fileCreatedCount + 1
    dLog('tcx success', commonFileName, `${fileCreatedCount}/${totalLength}`);
}

function makeFIT(basePath, jsonFileName, totalLength) {
    // 统一按类json同名文件命名
    const commonFileName = jsonFileName.replace(/\.json$/, '').replace(/\s+/, '_');

    let data = fs.readFileSync(`${basePath}/json/${jsonFileName}`);
    data = JSON.parse(data.toString())
    const { trackList = [], simplifyValue } = data;
    if (trackList.length === 0) {
        return;
    }
    const firstTrack = trackList[0] || {};
    const startTimeTs = new Date(firstTrack.Time).getTime();
    const startTimeFit = parseInt((startTimeTs - FIT_EPOCH_MS) / 1000);
    const totalTimeSeconds = parseInt(simplifyValue.totalTime/ 1000);
    const endTimeFit = parseInt((startTimeTs + simplifyValue.totalTime - FIT_EPOCH_MS) / 1000);

    const heartRateList = trackList.filter(item => item.HeartRateBpm).map(item => [1, item.HeartRateBpm]);
    const heartRateSummary = getSummaryFromList(heartRateList);
    const cadenceList = trackList.filter(item => item.Cadence).map(item => [1, item.Cadence]);
    const cadenceSummary = getSummaryFromList(cadenceList);
    // 根据距离、步频、时间推算出步幅
    const stepLengthAvg = parseInt(simplifyValue.totalDistance / ((cadenceSummary.avg*2/60) * totalTimeSeconds) * 1000);
    // 兜底generic
    const activeType = sportTypeFitActivityTypeMap[simplifyValue.sportType] || 0;


    const fieldList = ['Field', 'Value', 'Units'];
    const keyList = ['Type', 'Local Number', 'Message'].concat(...Array(25).fill(1).map((_, index) => {
        const num = index + 1;
        return fieldList.map(item => item + ' ' + num)
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
            ['timestamp', timeFit, 's']
        ];

        if (item.Position) {
            // 加入gcj02坐标系转换为wgs84
            const transformer = item.Position.positionType === 'gcj02' ? gpsTransformer.gcj02towgs84 : justReturnPosition;
            const [LongitudeDegrees, LatitudeDegrees] = transformer(item.Position.LongitudeDegrees, item.Position.LatitudeDegrees);
            eachList.push(
                ['position_lat', parseInt(LatitudeDegrees * ( Math.pow(2, 31) / 180 )), 'semicircles'],
                ['position_long', parseInt(LongitudeDegrees * ( Math.pow(2, 31) / 180 )), 'semicircles'],
            )
        }
        if (item.HeartRateBpm) {
            eachList.push(
                ['heart_rate', item.HeartRateBpm.Value * 1, 'bpm']
            )
        }
        if (item.Cadence) {
            eachList.push(
                ['cadence', item.Cadence, 'rpm']
            )
        }

        if (item.speed) {
            eachList.push(
                ['speed', (item.speed/10).toFixed(3), 'm/s']
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

    let lastDefinition = [];
    trackList.forEach((item, index) => {
        const timeTs = new Date(item.Time).getTime();
        const timeFit = parseInt((timeTs - FIT_EPOCH_MS) / 1000);
        if (index === 0) {
            infoList.push(
                gen([['Definition', 0, 'record'], ['timestamp', 1], ['distance', 1], ['activity_type', 1]]),
                gen([['Data', 0, 'record'], ['timestamp', timeFit, 's'], ['distance', 0, 'm'], ['activity_type', activeType]]),
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

    const paceMap = simplifyValue.paceMap || {};
    if (Object.keys(paceMap).length > 0) { // 有配速信息，可将每公里作为一圈
        // start_time、timestamp 分别对应起始时间
        // total_timer_time和total_elapsed_time的值相同
        // 步频
        // 心率
        // 配速
        infoList.push(
            gen([
                ['Definition', 0, 'lap'],
                ['start_time', 1],
                ['timestamp', 1],
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
            ]),
        )
        Object.keys(paceMap).reduce((acc, curr) => {
            const totalDistance = parseInt(curr / 10000);
            const elapsedTimeSeconds = paceMap[curr];

            const lapStartTimeTs =  startTimeTs + acc.totalElapsedTimeSeconds * 1000;
            const lapEndTimeTs =  startTimeTs + (acc.totalElapsedTimeSeconds + elapsedTimeSeconds)* 1000;

            const lapCadenceTrackList = trackList.filter(item => {
                const ts = new Date(item.Time).getTime();
                return ts >= lapStartTimeTs && ts<= lapEndTimeTs && item.Cadence;
            }).map(item => [1, item.Cadence * 1]);
            const lapCadenceSummary = getSummaryFromList(lapCadenceTrackList);

            const lapHeartRateTrackList = trackList.filter(item => {
                const ts = new Date(item.Time).getTime();
                return ts >= lapStartTimeTs && ts<= lapEndTimeTs && item.HeartRateBpm && item.HeartRateBpm.Value;
            }).map(item => [1, item.HeartRateBpm.Value * 1]);
            const lapHeartRateSummary = getSummaryFromList(lapHeartRateTrackList);

            const lapSpeedTrackList = trackList.filter(item => {
                const ts = new Date(item.Time).getTime();
                return ts >= lapStartTimeTs && ts<= lapEndTimeTs && item.speed;
            }).map(item => [1, item.speed / 10]);
            const lapSpeedSummary = getSummaryFromList(lapSpeedTrackList);

            // 一定有的
            const lapTotalDistance = totalDistance - acc.elapsedDistance;
            const list = [
                ['Data', 0, 'lap'],
                ['start_time', startTimeFit + acc.totalElapsedTimeSeconds],
                ['timestamp', startTimeFit + acc.totalElapsedTimeSeconds + elapsedTimeSeconds, 's'],
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
                const stepLengthAvg = parseInt(lapTotalDistance / ((lapCadenceSummary.avg * 2/60) * elapsedTimeSeconds) * 1000);
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

            infoList.push(gen(list));

            return {
                totalElapsedTimeSeconds: elapsedTimeSeconds + acc.totalElapsedTimeSeconds,
                elapsedDistance: totalDistance,
            }
        }, {
            totalElapsedTimeSeconds: 0,
            elapsedDistance: 0,
        })
    } else { // 无配速信息则全程数据作为一圈
        infoList.push(
            gen([
                ['Definition', 0, 'lap'],
                ['start_time', 1],
                ['timestamp', 1],
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
            ]),
            gen([
                ['Data', 0, 'lap'],
                ['start_time', startTimeFit],
                ['timestamp', endTimeFit, 's'],
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
            ])
        )
    }

    infoList.push(
        gen([
            ['Definition', 0, 'session'],
            ['start_time', 1],
            ['timestamp', 1],
            ['sport', 1],
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
        ]),
        gen([
            ['Data', 0, 'session'],
            ['start_time', startTimeFit],
            ['timestamp', endTimeFit, 's'],
            ['sport', 1],
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
        ]),
    )

    converter.json2csv(infoList, ((err, result) => {
        // 先写入csv文件，在使用jar完整 csv2fit
        fs.writeFileSync(`${basePath}/csv/${commonFileName}_${simplifyValue.sportType}.csv`, result);

        mkdirsSync(`${basePath}/fit/${simplifyValue.sportType}`);
        // 在腾讯云linux上java的路径和本机mac不同
        const javaPath = process.env.NODE_ENV === 'development' ? 'java' : '/usr/local/java/bin/java';
        const jarPath = path.join(__dirname, './FitCSVTool.jar')
        const command = `${javaPath} -jar ${jarPath} -c "${basePath}/csv/${commonFileName}_${simplifyValue.sportType}.csv"  "${basePath}/fit/${simplifyValue.sportType}/${commonFileName}.fit"`;
        // const command = `java -jar ${jarPath} -c "${basePath}/csv/${commonFileName}_${simplifyValue.sportType}.csv"  "${basePath}/fit/${simplifyValue.sportType}/${commonFileName}.fit"`;
        dLog('csv success', commonFileName);

        return new Promise((resolve) => {
            exec(command, (error, stdout, stderr) => {
                if (!error && !stderr) {
                    // 成功
                    fileCreatedCount = fileCreatedCount + 1
                    dLog('fit success', commonFileName, `${fileCreatedCount}/${totalLength}`);
                } else {
                    // 失败
                    dLog('fit fail', command, fileCreatedCount, error);
                    dLog(stderr);
                }
                resolve(command);
            });
        });
    }), {
        emptyFieldValue: ''
    });
}

async function pack(baseDir, info) {
    const { address, type, baseUrl, baseFilePath, fileName } = info;

    mkdirsSync(path.join(baseDir, 'csv'));
    mkdirsSync(path.join(baseDir, 'fit'));
    await runDirs(baseDir);
    Promise.all([
        makeZip(baseDir + '/fit', `${baseFilePath}/${fileName}/fit.zip`),
        makeZip(baseDir + '/tcx', `${baseFilePath}/${fileName}/tcx.zip`),
    ]).then(() => {
        const fitUrl = `${baseUrl}/fit.zip`;
        const tcxUrl = `${baseUrl}/tcx.zip`;

        let prevList = localStorage.getItem('list') || '[]';
        prevList = JSON.parse(prevList);
        const target = prevList.find(item => item.fileName === fileName);
        const ts = Date.now();
        if (target) {
            target.status = 'success';
            target.ts = ts;
            localStorage.setItem('list', JSON.stringify(prevList));
        } else {
            localStorage.setItem('list', JSON.stringify([
                ...prevList,
                {
                    address,
                    type,
                    fileName,
                    status: 'success',
                    ts,
                }
            ]));
        }


        dLog('zip success', `[${address} ${type}] ${baseFilePath}/${fileName}/fit.zip and tcx.zip`);
        sendMail('qq', {
            from: "justnotify@qq.com",
            to: address,
            subject: "运动记录转换完成通知 https://fit.bundless.cn",
            // text: "Plaintext version of the message",
            html: `您提交的运动记录已经成功转换成fit和tcx格式，结果文件已经准备好了，fit格式结果下载地址<a href="${fitUrl}" target="_blank">${fitUrl}</a>，tcx格式结果下载地址<a href="${tcxUrl}" target="_blank">${tcxUrl}</a>`,
        });
    }).catch(err => {
        dLog('zip error', err);
    })
}

module.exports = {
    makeTCX,
    runDirs,
    mkdirsSync,
    pack
}