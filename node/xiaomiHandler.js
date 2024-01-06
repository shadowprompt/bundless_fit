const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const extract = require('extract-zip')

const { dLog } = require('@daozhao/utils');

const { mkdirsSync, pack} = require('./tools');
const { readCsv } = require('./fsTools');
const { getXiaomiSportType } = require('./config');

const MINUTE_OFFSET = 6000; // 分钟误差（毫秒）

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
 * @param startTs
 * @param durableSeconds
 * @param endTs
 * @returns {*[]}
 */
function splitToSeconds(startTs, durableSeconds, endTs) {
    const DIMENSION = 1000; // 1秒钟的毫秒数
    // 换成整秒数，不足的加满为1秒
    let endTime = endTs ? endTs : startTs + durableSeconds * 1000;
    endTime = endTime % DIMENSION === 0 ? endTime : (parseInt(endTime/DIMENSION) * DIMENSION + DIMENSION);
    let startTime = startTs % DIMENSION === 0 ? startTs : (parseInt(startTs/DIMENSION) * DIMENSION + DIMENSION);
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
    calories: ['calorieMap', 'calories'],
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
    const sportStartTime = Value.start_time * 1000;
    const sportEndTime = Value.end_time * 1000;
    const sportTime = Value.duration;

    const {year, month, day} = getDateTime(sportStartTime);
    const startDate =`${year}-${month}-${day}`;

    return {
        sportType: Value.sport_type,
        protoType: Value.proto_type,
        startDate,
        startTs: sportStartTime,
        endTs: sportEndTime,
        sportStartTime,
        sportTime,
        maxPace: Value.max_pace,
        minPace: Value.min_pace,
        maxHeartRate: Value.max_hrm,
        avgHeartRate: Value.avg_hrm,
        avgPace: 0,
        distance: Value.distance,
        calories: Value.total_cal || Value.calories, // 总热量 || 运动热量
        pool_width: Value.pool_width, // 游泳池单趟长度
        turn_count: Value.turn_count, // 游泳池游的趟数
        stroke_count: Value.stroke_count, // 划水总次数
        max_stroke_freq: Value.max_stroke_freq, // 最大划水频率
        best_swolf: Value.best_swolf,
        avg_swolf: Value.avg_swolf,
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

function collectDetailMapNew (sportInfo, workSheetInfo, collection) {
    let { startTs, endTs, sportStartTime } = sportInfo;

    for ( ;workSheetInfo.startNum <= workSheetInfo.endNum; workSheetInfo.startNum++) {
        const dataItem = workSheetInfo.list[workSheetInfo.startNum];
        let {Sid, Key, Value} = dataItem;
        Value = Value.includes('{') ? JSON.parse(Value) : Value;
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
    // 没有则直接无视本次收集
    if (!heartRateMap || !stepMap) {
        return;
    }
    let { sportType, protoType, startDate, startTs, endTs, sportStartTime, sportTime, maxPace, minPace, avgPace, maxHeartRate, avgHeartRate, distance, calories } = sportInfo;

    const {year, month, day, hours, minutes, seconds} = getDateTime(sportStartTime);
    const date = `${year}-${month}-${day}`;
    const localTime = `${year}-${month}-${day} ${hours}_${minutes}_${seconds}`;

    const heartRateList = heartRateMap[sportStartTime]?.list || [];
    const stepList = stepMap[sportStartTime]?.list || [];
    const activityStageList = activityStageMap[sportStartTime]?.list || [];
    // 根据运行开始时间和持续时间，划分成各以一秒钟维度的列表
    const sportMinuteList = splitToSeconds(startTs, sportTime, endTs);

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

        return trackpoint;
        if (hasData) {
            return trackpoint;
        }
    })
    // 仅保留有有效数据的
    // trackList = trackList.filter(item => item);

    const simplifyValue = {
        totalTime: sportTime * 1000,
        totalDistance: distance,
        bestPace: maxPace,
        minPace,
        avgPace,
        totalCalories: calories * 1000,
        avgHeartRate: avgHeartRate || heartRateSummary.avg, // 优先使用数据自带的
        maxHeartRate: maxHeartRate || heartRateSummary.max,
        sportType: getXiaomiSportType(sportType, protoType),
        pool_width: sportInfo.pool_width,
        turn_count: sportInfo.turn_count,
        stroke_count: sportInfo.stroke_count,
        max_stroke_freq: sportInfo.max_stroke_freq,
        best_swolf: sportInfo.best_swolf,
        avg_swolf: sportInfo.avg_swolf,
    }

    mkdirsSync(path.join(baseDir, 'json'));
    fs.writeFileSync(path.join(baseDir, `json/${localTime}.json`), JSON.stringify({
        trackList,
        simplifyValue,
        _source: 'xiaomi',
        startTs: sportStartTime,
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

const list = [
    '1000-01-01 00:00:00',
    '2020-10-04 00:00:00',
    '2021-09-04 00:00:00',
    '2022-08-27 00:00:00',
    '3000-12-26 00:00:00',
];

// 运动记录太长是需要分段处理
let sportSplitInfo;
let sportSplitIndex = 0;
sportSplitInfo = {
    startTs: new Date(list[sportSplitIndex]).getTime(),
    endTs: new Date(list[sportSplitIndex + 1]).getTime(),
};

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
            // 数据量过大时采用分段模式
            if (sportSplitInfo) {
                // 分段模式 介于分段时间内才进行遍历
                if (sportInfo.startTs <= sportSplitInfo.endTs && sportInfo.startTs >= sportSplitInfo.startTs) {
                    iterator(sportInfo);
                }
            } else {
                iterator(sportInfo);
            }
        }
    }
    // fitness详情
    const list = await readCsv(baseDir + '/' + FITNESS_FILE);
    const worksheetInfoHeartRateAuto = {
        startNum: 0,
        endNum: list.length - 1,
        list,
    }

    // const workbookFitness = XLSX.readFile(baseDir + '/' + FITNESS_FILE, {cellDates: true, dateNF: "yyyy-mm-dd"});
    // const sheetNameFitness = workbookFitness.SheetNames[0];
    // const firstSheetFitness = workbookFitness.Sheets[sheetNameFitness];
    // const refInfoFitness = firstSheetFitness['!ref'];
    // const { startNum: startNumFitness, endNum: endNumFitness  } = getRefInfo(refInfoFitness);
    // const worksheetInfoHeartRateAuto = {
    //     startNum: startNumFitness,
    //     endNum: endNumFitness,
    //     firstSheet: firstSheetFitness,
    // };
    // 第一次迭代收集具体数据
    sportIterator((sportInfo) => {
        // 收集各sport期间的具体信息（心率、步数等）
        collectDetailMapNew(sportInfo, worksheetInfoHeartRateAuto, collection);
    })
    dLog('sportIterator 1st completed', Object.keys(collection).length);

    if (Object.keys(collection).length === 0) {
        dLog('warn', 'no data');
        return;
    }

    // 第二次迭代收集具体数据
    sportIterator((sportInfo) => {
        // 聚合各sport期间的具体信息（心率、步数等）
        collectData(sportInfo, baseDir, collection);
    })
    dLog('sportIterator 2st completed');
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
