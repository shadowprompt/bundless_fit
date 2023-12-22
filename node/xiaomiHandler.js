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
    const value = ((result && result.v || '') + '').trim();
    // value为json字符串时，转换成json对象
    return value.includes('{') ? JSON.parse(value) : value;
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
 * 根据开始时间和持续时间计算出对应的秒区间
 * @param startTime
 * @param durableSeconds
 * @returns {*[]}
 */
function splitToSeconds(startTime, durableSeconds) {
    const DIMENSION = 1000; // 1分钟的毫秒数
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

const resultValueMap = {
    steps: ['stepMap', 'steps'],
    heart_rate: ['heartRateMap', 'bpm'],
}
function setData(key, collection, Value, sportStartTime, Sid) {
    const [resultProp, valueProp] = resultValueMap[key] || [];
    if (resultProp) {
        if (!collection[resultProp]) {
            collection[resultProp] = {};
        }
        const result = collection[resultProp];
        if (!result[sportStartTime]) {
            result[sportStartTime] = {
                date: sportStartTime,
                list: [],
            }
        }
        // 记录时间、对应的值、数据来源Sid
        result[sportStartTime].list.push([Value['time'] * 1000, Value[valueProp], Sid]);
    }
}

function combineSportInfo(sport) {
    let [Uid, Sid, Key, Time, Category, Value, ...rest] = sport;
    const sportType = Value.sport_type;
    const sportStartTime = Value.start_time * 1000;
    const sportTime = Value.duration;

    const {year, month, day} = getDateTime(sportStartTime);
    const startDate =`${year}-${month}-${day}`;

    const startTs = new Date(sportStartTime).getTime();
    const endTs = startTs + sportTime*1000;

    return {
        sportType,
        startDate,
        startTs,
        endTs,
        sportStartTime,
        sportTime,
        maxPace: Value.max_pace,
        minPace: Value.min_pace,
        maxHeartRate: Value.max_hrm,
        avgHeartRate: Value.avg_hrm,
        avgPace: 0,
        distance: Value.distance,
        calories: Value.calories,
    };
}

function collectDetailMap(sportInfo, workSheetInfo, collection) {
    let { startTs, endTs, sportStartTime } = sportInfo;

    const sheetList = ['B', 'C', 'E'];

    for ( ;workSheetInfo.startNum <= workSheetInfo.endNum; workSheetInfo.startNum++) {
        let [Sid, Key, Value] = getValue(sheetList.map(item => item + '' + workSheetInfo.startNum), workSheetInfo.firstSheet);
        // 当期类型记录项的发生时间
        let _ts = Value.time * 1000;

        if ( _ts >= startTs && _ts <= endTs) {
            setData(Key, collection, Value, sportStartTime, Sid);
        }
        // 时间已经超过结束时间
        if (_ts > endTs) {
            workSheetInfo.startNum--; // 回退到上一个
            break;
        }
    }
    return collection;
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
    const { heartRateMap, stepMap, activityStageMap = {} } = detailJsonObj;
    let { sportType, startDate, startTs, endTs, sportStartTime, sportTime, maxPace, minPace, avgPace, maxHeartRate, avgHeartRate, distance, calories } = sportInfo;

    const {year, month, day, hours, minutes, seconds} = getDateTime(sportStartTime);
    const date = `${year}-${month}-${day}`;
    const localTime = `${year}-${month}-${day} ${hours}_${minutes}_${seconds}`;

    const heartRateList = heartRateMap[sportStartTime]?.list || [];
    const stepList = stepMap[sportStartTime]?.list || [];
    const activityStageList = activityStageMap[sportStartTime]?.list || [];
    // 根据运行开始时间和持续时间，划分成各以一分钟维度的列表
    const sportMinuteList = splitToSeconds(sportStartTime, sportTime);

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

    let trackList = sportMinuteList.map((item) => {
        const {year, month, day, hours, minutes, seconds} = getDateTime(item);
        const utcTime = toUTCTimeStr({year, month, day, hours, minutes, seconds});
        const trackpoint = {
            Time: utcTime,
        };
        const targetHeartRateList = heartRateList.filter(([ts]) => {
            return item === ts;
        })
        const targetStepList = stepList.filter(([ts]) => {
            return item === ts;
        })
        // 标记是否有有效数据
        let hasData = false;

        if (targetHeartRateList[0]) {
            hasData = true;
            trackpoint.HeartRateBpm = {
                $: {
                    'xsi:type': 'HeartRateInBeatsPerMinute_t'
                },
                Value: targetHeartRateList[0][1],
            }
        }
        if (targetStepList[0]) {
            hasData = true;
            trackpoint.Cadence = parseInt(targetStepList[0][1] / 2);
        }
        dLog(`${year}-${month}-${day} ${hours}:${minutes}`, targetHeartRateList.join('='), targetStepList.join('='));

        if (hasData) {
            return trackpoint;
        }
    })
    // 仅保留有有效数据的
    trackList = trackList.filter(item => item);

    const simplifyValue = {
        totalTime: sportTime * 1000,
        totalDistance: distance,
        bestPace: maxPace,
        minPace,
        avgPace,
        totalCalories: calories * 1000,
        avgHeartRate: avgHeartRate || heartRateSummary.avg, // 优先使用数据自带的
        maxHeartRate: maxHeartRate || heartRateSummary.max,
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
    matchedList.push(fileList.find(item => /hlth_center_sport_record\.csv/i.test(item)));
    matchedList.push(fileList.find(item => /hlth_center_fitness_data\.csv/i.test(item)));
    matchedList.unshift(filePath);

    matchedList = matchedList.filter(item => item); // 过滤掉空的

    if (matchedList.length === 3) {
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
    const [baseDir, SPORT_FILE, FITNESS_FILE] = dirs;

    const isJsonDirExist = fs.existsSync(path.join(baseDir, 'json'));

    if (isJsonDirExist) {
        await pack(baseDir, info);
        return
    }

    const sportPath = baseDir + '/' + SPORT_FILE;

    const sportWorkbook = XLSX.readFile(sportPath, {cellDates: true, dateNF: "yyyy-mm-dd"});
    const sportSheetName = sportWorkbook.SheetNames[0];
    const sportFirstSheet = sportWorkbook.Sheets[sportSheetName];

    const sportSheetList = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    // const [_Uid, _Sid, _Key, _Time, _Category, _Value, _UpdateTime] = sportSheetList;
    // 心率 步数等集合
    const collection = {};

    function sportIterator(iterator) {
        const refInfo = sportFirstSheet['!ref'];
        const { startNum, endNum } = getRefInfo(refInfo);
        // sport数据默认是升序，直接使用
        for (let keyNumber = startNum;keyNumber <= endNum; keyNumber++) {
            // 遍历sport
            const sport = getValue(sportSheetList.map(item => item + '' + keyNumber), sportFirstSheet);
            const sportInfo = combineSportInfo(sport);
            iterator(sportInfo);
        }
    }
    // fitness详情
    const workbookFitness = XLSX.readFile(baseDir + '/' + FITNESS_FILE, {cellDates: true, dateNF: "yyyy-mm-dd"});
    const sheetNameFitness = workbookFitness.SheetNames[0];
    const firstSheetFitness = workbookFitness.Sheets[sheetNameFitness];
    const refInfoFitness = firstSheetFitness['!ref'];
    const { startNum: startNumFitness, endNum: endNumFitness  } = getRefInfo(refInfoFitness);
    const worksheetInfoHeartRateAuto = {
        startNum: startNumFitness,
        endNum: endNumFitness,
        firstSheet: firstSheetFitness,
    };
    // 第一次迭代收集具体数据
    sportIterator((sportInfo) => {
        // 收集各sport期间的具体信息（心率、步数等）
        collectDetailMap(sportInfo, worksheetInfoHeartRateAuto, collection);
    })
    // 第二次迭代收集具体数据
    sportIterator((sportInfo) => {
        // 聚合各sport期间的具体信息（心率、步数等）
        collectData(sportInfo, baseDir, collection);
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
