const fs = require('fs');
const path = require('path');
const { dLog } = require('@daozhao/utils');
const extract = require('extract-zip');

const { mkdirsSync, pack } = require('./tools');

const { runDirs } = require('./tools')
const { sendMail, makeZip } = require('./mail');

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

function calcDateFlag(data) {
    let dateT;
    if (data.tp === 'lbs') {
        // 可能包含E，也可能直接是时间戳
        if (data.t.includes('E')) {
            let [value, b] = data.t.split('E');
            value = value.padEnd(11, '0'); // 补齐成统一的11位
            dateT = value.slice(0, 11) + 'E12';
        } else {
            dateT = data.t;
        }
    } else {
        dateT = data.k.slice(0,10) + '000';
    }
    return {
        ts: dateT * 1,
        isoTime: new Date(dateT * 1).toISOString()
    };
}

/**
 * 收集单词运动信息
 * trackList以tcx文件格式类型返回
 * @param motion
 * @returns {{trackList: *[], simplifyValue: any}}
 */
function collectData(motion, baseDir) {
    const attribute = motion.attribute;
    const infoList = attribute.split('&').filter(item => item).map(item => item.split('@is'));
    const [detailLabel, detailValueStr] = infoList.find((label, value) => /DETAIL/i.test(label)) || [];
    let [simplifyLabel, simplifyValueStr] = infoList.find((label, value) => /SIMPLIFY/i.test(label)) || [];
    const detailValueList = detailValueStr.split('tp=').filter(item => item);
    const simplifyValue = JSON.parse(simplifyValueStr);

    const trackList = [];
    let lastCadenceTs = 0;

    let lastTrack;
    detailValueList.forEach(item => {
        const [tp, ...rest] = item.split(';').filter(item => !/\s+/.test(item));
        const data = rest.map(item => item.split('=')).reduce((acc, [key, value]) => ({
            ...acc,
            [key]: value
        }), {tp});
        //
        if (['lbs', 'h-r', 's-r'].includes(data.tp)) {
            const { ts, isoTime } = calcDateFlag(data);
            let targetTrack = trackList.find(item => item.Time === isoTime);
            if (!targetTrack) {
                targetTrack = {
                    Time: isoTime,
                }
                trackList.push(targetTrack);
            }
            if (data.tp === 'lbs' && data.lat && data.lon > 0 ) {
                // 实测发现华为批量导出的经纬度不准，需要修正 维度 + 0.002075，经度 - 0.004345
                targetTrack.Position = {
                    LatitudeDegrees: data.lat, // 使用semicircles单位时，需要换算：semicircles=degrees * ( 2^31 / 180 )
                    LongitudeDegrees: data.lon,
                }
            } else if(data.tp === 'h-r') {
                targetTrack.HeartRateBpm = {
                    $: {
                        'xsi:type': 'HeartRateInBeatsPerMinute_t'
                    },
                    Value: data.v,
                }
            } else if(data.tp === 's-r') { // 使用rpm单位时，需要换算：除以2
                targetTrack.Cadence = parseInt(data.v / 2);
                lastCadenceTs = ts;
            }
            lastTrack = targetTrack;
        } else if (data.tp === 'rs') { // 实时速度 因为其没有时间信息，就近挂载至上一个track记录上
            lastTrack.speed = data.v; // 非TCX标准属性
        }
    })

    trackList.sort((a, b) => new Date(a.Time) - new Date(b.Time));

    const firstTrack = trackList[0] || {};
    const startTimeTs = new Date(firstTrack.Time).getTime();
    const {year, month, day, hours, minutes, seconds} = getDateTime(startTimeTs);
    const localTime = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;


    mkdirsSync(path.join(baseDir, `json`))
    fs.writeFileSync(path.join(baseDir, `json/${localTime}.json`), JSON.stringify({
        trackList,
        simplifyValue,
    }, null ,2));

    return {
        trackList,
        simplifyValue
    }
}

function findBaseDir(filePath) {
    let fileList = fs.readdirSync(filePath) || [];
    if (fileList.length === 0) {
        return;
    }

    let matchedList = [];
    matchedList.push(fileList.find(item => /motion path detail data\.json/i.test(item)));
    matchedList.unshift(filePath);

    matchedList = matchedList.filter(item => item); // 过滤掉空的

    if (matchedList.length === 2) {
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

function preCheck(filePath) {
    return new Promise(async (resolve) => {
        try {
            // 同名文件夹
            const dir = filePath.replace(/\.zip$/, '');
            await extract(filePath, { dir });
            console.log('Extraction complete', filePath);
            resolve(findBaseDir(dir));
        } catch (err) {
            // handle any errors
            resolve();
        }
    })


}

async function generate(dirs, address, info) {
    const [baseDir, MOTION_FILE] = dirs;

    const jsonDirPath = path.join(baseDir, 'json');
    const isDirExist = fs.existsSync(jsonDirPath);

    if (isDirExist) {
        await pack(baseDir, address, info);
        return;
    }

    const motionPath = baseDir + '/' + MOTION_FILE;
    const motionList =  require(motionPath);

    motionList.forEach(motion => {
        collectData(motion, baseDir);
    })
    // 数据已收集完毕再次执行generate
    generate(dirs, address, info);
}

async function parser(evt) {
    const { requestBody: { address, info = {} } = {} } = evt.data;
    dLog('Parsing -> ', info.filePath);
    const dirs = await preCheck(info.filePath);
    if (!dirs) {
        return; // 未找到
    }

    generate(dirs, address, info);

    return {
        list: [],
    };
}


const sportBriefKeyList = [
    {
        key: 'totalTime', // 毫秒数
    },
    {
        key: 'totalDistance', // 总距离
    },
    {
        key: 'bestPace', // 最佳配速
    },
    {
        key: 'totalCalories', // 总卡路里
    },
    {
        key: 'avgHeartRate', // 平均心率
    },
    {
        key: 'maxHeartRate', // 最大心率
    },
    {
        key: 'sportType', // 运动类型
    },
];

module.exports = {
    parser,
    preCheck,
};
