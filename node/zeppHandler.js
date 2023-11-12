const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const extract = require('extract-zip')

const { dLog } = require('@daozhao/utils');

const { mkdirsSync, pack} = require('./tools');

const MINUTE_OFFSET = 6000; // 分钟误差（毫秒）
// 映射成跟huawei统一的，方便统一处理
const sportType2HuaweiMap = {
    1: 258, // 'Running',
    6: 257, // 'Walking',
    8: 264, // 'Running', // 室内跑步（跑步机）
    9: 259, // 'Biking',
    16: 279, // 'MultiSport', // 自由活动
};

function getRefInfo(ref) {
    const [startCellName, endCellName] = ref.split(':');
    const startNum = startCellName.split(/[A-Z]/)[1];
    const startLetter = startCellName.replace(startNum, '');
    const endNum = endCellName.split(/[A-Z]/)[1];
    const endLetter = endCellName.replace(endNum, '');
    return {
        startNum: startNum * 1 + 1, // 第一行为表头信息，直接从下一行开始
        startLetter,
        endNum: endNum * 1,
        endLetter
    };
}

function getItem(result) {
    const value = (result && result.v || '') + '';
    return value.trim();
}

function getValue(sheetList, sheet) {
    return sheetList.map(item => getItem(sheet[`${item}`]))
}

function getDateTime(s) {
    const d = new Date(s);
    const year = (d.getFullYear() + '');
    const month = (d.getMonth() + 1 + '').padStart(2, '0');
    const day = (d.getDate() + '').padStart(2, '0');
    const hours = (d.getHours() + '').padStart(2, '0');
    const minutes = (d.getMinutes() + '').padStart(2, '0');
    const seconds = (d.getSeconds() + '').padStart(2, '0');
    return {
        year,
        month,
        day,
        hours,
        minutes,
        seconds,
    }
}

/**
 * 根据开始时间和持续时间计算出对应的分钟区间
 * @param startTime
 * @param durableSeconds
 * @returns {*[]}
 */
function splitToMinutes(startTimeStr, durableSeconds) {
    let startTime = new Date(startTimeStr).getTime();
    const DIMENSION = 60000; // 1分钟的毫秒数
    // 换成整分钟数，不足的加满为1分钟
    let endTime = startTime + durableSeconds * 1000;
    endTime = endTime % DIMENSION === 0 ? endTime : (parseInt(endTime/DIMENSION) * DIMENSION + DIMENSION);
    startTime = startTime % DIMENSION === 0 ? startTime : (parseInt(startTime/DIMENSION) * DIMENSION + DIMENSION);
    const result = [];
    while (endTime - startTime >= 0) {
        result.push(startTime);
        startTime = startTime + DIMENSION;
    }
    return result;
}

function startStopMatch(_startTs, _stopTs, startTs, endTs) {
    const a1 = _startTs >= startTs;
    const a2 = Math.abs(_startTs - startTs) <= MINUTE_OFFSET;
    const b1 = endTs >= _stopTs;
    const b2 = Math.abs(endTs - _stopTs) <= MINUTE_OFFSET;
    return [a1, a2, b1, b2];
}

function collectDetailMap(sportInfo, workSheetInfo, resultMap, detailType) {
    let {sportType, startDate, startTs, endTs, sportStartTime, sportTime } = sportInfo;

    const sheetList = detailType === 'activityStage' ? ['A', 'B', 'C', 'D', 'E', 'F'] : ['A', 'B', 'C'];

    for ( ;workSheetInfo.startNum <= workSheetInfo.endNum; workSheetInfo.startNum++) {
        let [date, ...rest] = getValue(sheetList.map(item => item + '' + workSheetInfo.startNum), workSheetInfo.firstSheet);
        const { year, month, day } = getDateTime(date);
        date = `${year}-${month}-${day}`;
        // 如果心率日期已经大于运动日期，则无需继续查找
        if (new Date(`${date} 00:00:00`) > new Date(`${startDate} 00:00:00`)) {
            workSheetInfo.startNum--; // 回退到上一个
            break;
        }

        if (date === startDate) {
            if (detailType === 'activityStage') {
                const [_startTime, _stopTime] = rest;
                const _startTs = new Date(`${date} ${_startTime}:00`).getTime();
                const _stopTs = new Date(`${date} ${_stopTime}:00`).getTime();
                // 当前stage的开始时间大于等于运动开始时间（或仅稍微小MINUTE_OFFSET）+
                // 当前stage的结束时间小于等于运动结束时间（或仅稍微大MINUTE_OFFSET）
                const [a1, a2, b1, b2] = startStopMatch(_startTs, _stopTs, startTs, endTs);
                if ((a1 || a2) && (b1 || b2)) {
                    if (!resultMap[startDate]) {
                        resultMap[startDate] = {
                            date: date,
                            type: sportType,
                            list: [],
                        }
                    }
                    resultMap[startDate].list.push(rest);
                    dLog(sportStartTime, sportTime, '/', detailType, startDate, _startTime, _stopTime, a1, a2, b1, b2);
                }
            } else {
                const [_time] = rest;
                const _ts = new Date(`${date} ${_time}:00`).getTime();
                if ( _ts >= startTs && _ts <= endTs) {
                    if (!resultMap[startDate]) {
                        resultMap[startDate] = {
                            date: date,
                            type: sportType,
                            list: [],
                        }
                    }
                    resultMap[startDate].list.push(rest);
                    dLog(sportStartTime, sportTime, '/', detailType, startDate, _time)
                }
            }
        }
    }
    return resultMap;
}

function toUTCTimeStr({year, month, day, hours, minutes, seconds}) {
    return new Date(`${year}-${month}-${day} ${hours}:${minutes}:${seconds}`).toISOString();
}

function getSummaryFromList(list) {
    const max =  list.reduce((acc, [, value]) => Math.max(acc, value), 0);
    const total =  list.reduce((acc, [, value]) => acc + value * 1, 0);
    const avg = list.length > 0 ? parseInt(total / list.length) : 0;
    return {
        max,
        total,
        avg,
    }
}

function collectData(sportInfo, baseDir, detailJsonObj) {
    const { heartRateMap, stepMap, activityStageMap } = detailJsonObj;
    let [sportType, sportStartTime, sportTime, maxPace, minPace, distance, avgPace, calories] = sportInfo;

    const {year, month, day, hours, minutes, seconds} = getDateTime(sportStartTime);
    const date = `${year}-${month}-${day}`;
    const localTime = `${year}-${month}-${day} ${hours}_${minutes}_${seconds}`;

    const heartRateList = heartRateMap[`${year}-${month}-${day}`]?.list || [];
    const stepList = stepMap[`${year}-${month}-${day}`]?.list || [];
    const activityStageList = activityStageMap[`${year}-${month}-${day}`]?.list || [];
    // 根据运行开始时间和持续时间，划分成各以一分钟维度的列表
    const sportMinuteList = splitToMinutes(sportStartTime, sportTime);
    const startTs = new Date(sportStartTime).getTime();
    const endTs = startTs + sportTime*1000;

    const heartRateSummary = getSummaryFromList(heartRateList);
    const stepSummary = getSummaryFromList(stepList);
    const targetActivityStageList = activityStageList.filter(([_startTime, _stopTime]) => {
        const _startTs = new Date(`${date} ${_startTime}:00`).getTime();
        const _stopTs = new Date(`${date} ${_stopTime}:00`).getTime();
        const [a1, a2, b1, b2] = startStopMatch(_startTs, _stopTs, startTs, endTs);
        return (a1 || a2) && (b1 || b2);
    });

    const totalStep = targetActivityStageList.reduce((acc, curr) => {
        const step = curr[curr.length - 1] * 1;
        return acc + step;
    }, 0);

    const trackList = sportMinuteList.map((item) => {
        const {year, month, day, hours, minutes, seconds} = getDateTime(item);
        const utcTime = toUTCTimeStr({year, month, day, hours, minutes, seconds});
        const trackpoint = {
            Time: utcTime,
        };
        const targetHeartRateList = heartRateList.filter(([time]) => {
            const ts = new Date(`${year}-${month}-${day} ${time}:00`);
            return item - ts >= 0 && item - ts < 60000;
        })
        const targetStepList = stepList.filter(([time]) => {
            const ts = new Date(`${year}-${month}-${day} ${time}:00`);
            return item - ts >= 0 && item - ts < 60000;
        })
        if (targetHeartRateList[0]) {
            trackpoint.HeartRateBpm = {
                $: {
                    'xsi:type': 'HeartRateInBeatsPerMinute_t'
                },
                Value: targetHeartRateList[0][1],
            }
        }
        if (targetStepList[0]) {
            trackpoint.Cadence = parseInt(targetStepList[0][1] / 2);
        }
        dLog(`${year}-${month}-${day} ${hours}:${minutes}`, targetHeartRateList.join('='), targetStepList.join('='));
        return trackpoint;
    })

    const simplifyValue = {
        totalTime: sportTime * 1000,
        totalDistance: distance,
        bestPace: maxPace,
        minPace,
        avgPace,
        totalCalories: calories * 1000,
        avgHeartRate: heartRateSummary.avg,
        maxHeartRate: heartRateSummary.max,
        sportType: sportType2HuaweiMap[sportType] || sportType2HuaweiMap[1],
    }

    mkdirsSync(path.join(baseDir, 'json'));
    fs.writeFileSync(path.join(baseDir, `json/${localTime}.json`), JSON.stringify({
        trackList,
        simplifyValue
    }, null, 2));
}


function findBaseDir(filePath) {
    let fileList = fs.readdirSync(filePath) || [];
    if (fileList.length === 0) {
        return;
    }

    let matchedList = [];
    matchedList.push(fileList.find(item => /SPORT.+\.csv/i.test(item)));
    matchedList.push(fileList.find(item => /HEARTRATE_AUTO.+\.csv/i.test(item)));
    matchedList.push(fileList.find(item => /ACTIVITY_MINUTE.+\.csv/i.test(item)));
    // matchedList.push(fileList.find(item => /ACTIVITY_STAGE.+\.csv/i.test(item)));
    matchedList.unshift(filePath);

    matchedList = matchedList.filter(item => item); // 过滤掉空的

    if (matchedList.length === 4) {
        return matchedList; // 当前目录即为目标目录
    }

    const dirs = fileList.filter(item => {
        const stat = fs.statSync(filePath + '/' + item);
        return stat.isDirectory();
    });
    const realFilePath = dirs.find(item => findBaseDir(filePath + '/' + item));
    if (realFilePath) {
        return findBaseDir(filePath + '/' + realFilePath);
    }
}

async function preCheck(filePath) {
    // 同名文件夹
    const dir = filePath.replace(/\.zip$/, '');
    try {
        await extract(filePath, { dir });
        dLog('Extraction complete');
        return findBaseDir(dir);
    } catch (err) {
        // handle any errors
    }
}

async function generate(dirs, info) {
    const [baseDir, SPORT_FILE, HEARTRATE_AUTO_FILE, ACTIVITY_MINUTE_FILE, ACTIVITY_STAGE_FILE] = dirs;

    const isJsonDirExist = fs.existsSync(path.join(baseDir, 'json'));

    if (isJsonDirExist) {
        await pack(baseDir, info);
        return
    }

    const sportPath = baseDir + '/' + SPORT_FILE;

    const sportWorkbook = XLSX.readFile(sportPath, {cellDates: true, dateNF: "yyyy-mm-dd"});
    const sportSheetName = sportWorkbook.SheetNames[0];
    const sportFirstSheet = sportWorkbook.Sheets[sportSheetName];

    const sportSheetList = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    // const [_type, _startTime, _sportTime, _maxPace, _minPace, _distance, _avgPace, _calories] = sportSheetList;

    // 心率
    const heartRateMap = {}
    // 步数
    const stepMap = {}
    // 运动阶段
    const activityStageMap = {}

    function sportIterator(iterator) {
        const refInfo = sportFirstSheet['!ref'];
        const { startNum, endNum } = getRefInfo(refInfo);
        // sport数据默认是降序，改成升序使用
        for (let keyNumber = endNum;keyNumber >= startNum; keyNumber--) {
            // 遍历sport
            const sportInfo = getValue(sportSheetList.map(item => item + '' + keyNumber), sportFirstSheet);
            iterator(sportInfo);
        }
    }
    // 心率
    const workbookHeartRateAuto = XLSX.readFile(baseDir + '/' + HEARTRATE_AUTO_FILE, {cellDates: true, dateNF: "yyyy-mm-dd"});
    const sheetNameHeartRateAuto = workbookHeartRateAuto.SheetNames[0];
    const firstSheetHeartRateAuto = workbookHeartRateAuto.Sheets[sheetNameHeartRateAuto];
    const refInfoHeartRateAuto = firstSheetHeartRateAuto['!ref'];
    const { startNum: startNumHeartRateAuto, endNum: endNumHeartRateAuto  } = getRefInfo(refInfoHeartRateAuto);
    const worksheetInfoHeartRateAuto = {
        startNum: startNumHeartRateAuto,
        endNum: endNumHeartRateAuto,
        firstSheet: firstSheetHeartRateAuto,
    };
    // 步数
    const workbookActivityMinute = XLSX.readFile(baseDir + '/' + ACTIVITY_MINUTE_FILE, {cellDates: true, dateNF: "yyyy-mm-dd"});
    const sheetNameActivityMinute = workbookActivityMinute.SheetNames[0];
    const firstSheetActivityMinute = workbookActivityMinute.Sheets[sheetNameActivityMinute];
    const refInfoActivityMinute = firstSheetHeartRateAuto['!ref'];
    const { startNum: startNumActivityMinute, endNum: endNumHeartActivityMinute  } = getRefInfo(refInfoActivityMinute);
    const worksheetInfoActivityMinute = {
        startNum: startNumActivityMinute,
        endNum: endNumHeartActivityMinute,
        firstSheet: firstSheetActivityMinute,
    };
    // 阶段
    // const workbookActivityStage = XLSX.readFile(baseDir + '/' + ACTIVITY_STAGE_FILE, {cellDates: true, dateNF: "yyyy-mm-dd"});
    // const sheetNameActivityStage = workbookActivityStage.SheetNames[0];
    // const firstSheetActivityStage = workbookActivityStage.Sheets[sheetNameActivityStage];
    // const refInfoActivityStage = firstSheetActivityStage['!ref'];
    // const { startNum: startNumActivityStage, endNum: endNumActivityStage  } = getRefInfo(refInfoActivityStage);
    // const worksheetInfoActivityStage = {
    //     startNum: startNumActivityStage,
    //     endNum: endNumActivityStage,
    //     firstSheet: firstSheetActivityStage,
    // };

    // 第一次迭代收集具体数据
    sportIterator((sport) => {
        let [sportType, sportStartTime, sportTime, ...rest] = sport;

        const {year, month, day} = getDateTime(sportStartTime);
        const startDate =`${year}-${month}-${day}`;

        const startTs = new Date(sportStartTime).getTime();
        const endTs = startTs + sportTime*1000;

        const sportInfo = {
            sportType,
            startDate,
            startTs,
            endTs,
            sportStartTime,
            sportTime,
        };
        // 收集各sport期间的具体信息（心率、步数等）
        collectDetailMap(sportInfo, worksheetInfoHeartRateAuto, heartRateMap, 'heartRate');
        collectDetailMap(sportInfo, worksheetInfoActivityMinute, stepMap, 'step');
        // collectDetailMap(sportInfo, worksheetInfoActivityStage, activityStageMap, 'activityStage');
    })
    // 第二次迭代收集具体数据
    sportIterator((sportInfo) => {
        // 聚合各sport期间的具体信息（心率、步数等）
        collectData(sportInfo, baseDir, {heartRateMap, stepMap, activityStageMap});
    })
    // 数据已收集完毕再次执行generate
    generate(dirs, info);
}
async function parser(evt) {
    console.time('parser');
    const { requestBody: { info = {} } = {}, dirs = [] } = evt.data;
    dLog('Parsing -> ', info.filePath);

    await generate(dirs, info);
    console.timeEnd('parser');

    return {
        list: [],
    };
}

module.exports = {
    parser,
    preCheck,
};
