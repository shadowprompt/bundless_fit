const fs = require('fs');
const path = require('path');
const { dLog } = require('@daozhao/utils');
const extract = require('extract-zip');

const { mkdirsSync, pack, fetchGeoInfo } = require('./tools');

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

function calcDateFlag(data, startTs) {
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
    } else if (data.tp === 'rs') {
        // data.k为从startTs开始运动的秒数
        dateT = startTs + (data.k * 1000);
    } else { // h-r s-r
        dateT = data.k.slice(0,10) + '000';
    }
    const date = new Date(dateT * 1);
    return {
        ts: date.getTime(),
        isoTime: date.toISOString(),
    };
}

/**
 * 收集单词运动信息
 * trackList以tcx文件格式类型返回
 * @param motion
 * @returns {{trackList: *[], simplifyValue: any}}
 */
async function collectData(motion, baseDir) {
    const attribute = motion.attribute;
    const infoList = attribute.split('&').filter(item => item).map(item => item.split('@is'));
    const [detailLabel, detailValueStr] = infoList.find((label, value) => /DETAIL/i.test(label)) || [];
    let [simplifyLabel, simplifyValueStr] = infoList.find((label, value) => /SIMPLIFY/i.test(label)) || [];
    const detailValueList = detailValueStr.split('tp=').filter(item => item);
    const simplifyValue = JSON.parse(simplifyValueStr);

    const trackList = [];
    let startTimeTs = 0;

    // 当前是否在中国大陆境内
    let isInChinaMainland;
    let address = '';

    function getItemData(item) {
        const [tp, ...rest] = item.split(';').filter(item => !/\s+/.test(item));
        return rest.map(item => item.split('=')).reduce((acc, [key, value]) => {
            // 如果已经有了，不再覆盖，因为发现最后一条后面会有
            // tp=rs;k=3285;v=0;(null);k=1700001029000;v=0;(null);k=1700001034000;v=0;
            // 后面的k=1700001029000会覆盖掉前面的
            if (Reflect.has(acc, key)) {
                return acc;
            } else {
                return {
                    ...acc,
                    [key]: value
                };
            }
        }, {tp});
    }

    function getFirstGPS(list) {
        for (const item of list) {
            const data = getItemData(item);
            if (data.tp === 'lbs' && data.lat && data.lon > 0 ) {
                return data;
            }
        }
    }
    // 根据第一个GPS信息判断是否为中国大陆境内
    const firstGPSData = getFirstGPS(detailValueList);
    if (firstGPSData) {
        const geoInfo = await fetchGeoInfo(firstGPSData.lon, firstGPSData.lat);
        isInChinaMainland = geoInfo.isInChinaMainland;
        address = geoInfo.address;
    }

    if (isInChinaMainland === false) {
        console.warn('不在中国大陆 ~ ', address, motion.coordinate);
    }

    detailValueList.forEach(item => {
        const data = getItemData(item);
        //
        if (['lbs', 'h-r', 's-r', 'pad', 'cad', 'rs', 'alti', 'scp'].includes(data.tp)) {
            const { ts, isoTime } = calcDateFlag(data, motion.startTime);
            // 将记录的第一个时间戳作为startTimeTs
            if (startTimeTs === 0) {
                startTimeTs = ts;
            }
            let targetTrack = trackList.find(item => item.Time === isoTime);
            if (!targetTrack) {
                targetTrack = {
                    Time: isoTime,
                }
                trackList.push(targetTrack);
            }
            if (data.tp === 'lbs' && data.lat && data.lon > 0 ) {
                // 根据坐标系或者供应商判断坐标系
                let positionType = 'GCJ02';
                if (motion.coordinate && motion.coordinate.toUpperCase() === 'GCJ02') {
                    positionType = 'GCJ02';
                } else if (motion.coordinate && motion.coordinate.toUpperCase() === 'WGS84') {
                    positionType = 'WGS84';
                } else if (motion.vendor && motion.vendor.toUpperCase() === 'AMAP') {
                    positionType = 'GCJ02';
                } else {
                    dLog('warn', 'unknown postionType');
                }
                targetTrack.Position = {
                    LatitudeDegrees: data.lat, // 使用semicircles单位时，需要换算：semicircles=degrees * ( 2^31 / 180 )
                    LongitudeDegrees: data.lon,
                    // 大陆的坐标则需要偏移
                    positionType: positionType, // 增加一个type标记当前坐标系，方便后续转换
                }
                targetTrack.AltitudeMeters = data.alt; // 海拔
                targetTrack._pointIndex = data.k; // 轨迹点数
            } else if(data.tp === 'h-r') { // 心率
                targetTrack.HeartRateBpm = {
                    $: {
                        'xsi:type': 'HeartRateInBeatsPerMinute_t'
                    },
                    Value: data.v,
                }
            } else if(data.tp === 's-r') { // 跑步步频 使用rpm单位时，需要换算：除以2
                targetTrack.Cadence = parseInt(data.v / 2);
            } else if(data.tp === 'pad') { // 划船机"步频"
                targetTrack.Cadence = data.v;
            } else if(data.tp === 'cad') { // 椭圆机"步频"
                targetTrack.Cadence = data.v;
            } else if(data.tp === 'p-f') { //游泳划水"步频"
                targetTrack.Cadence = data.v;
            } else if(data.tp === 'rs') { // 配速
                targetTrack.Extensions = {
                    'ns3:TPX': {
                        'ns3:Speed': data.v,
                        // 'ns3:Watts': 20,
                    }
                }
                targetTrack._speed = data.v; // 非TCX标准属性，仅为了取值方便
            } else if(data.tp === 'swf') { // 游泳swoft
                targetTrack._swf = data.v; // 非TCX标准属性
            } else if(data.tp === 'scp') { // 跳绳速度
                targetTrack._jumpRate = data.v; // 非TCX标准属性
            } else if(data.tp === 'alti') { // 海拔，如果前面有海拔信息，以此处为准
                targetTrack.AltitudeMeters = data.v;
            }
        }
    })

    trackList.sort((a, b) => new Date(a.Time) - new Date(b.Time));

    const {year, month, day, hours, minutes, seconds} = getDateTime(motion.startTime);
    const localTime = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;

    // 对比原来计算错误的
    if (!startTimeTs) {
        const {year, month, day, hours, minutes, seconds} = getDateTime(startTimeTs);
        const localTimeError = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
        console.log('startTimeTs异常 ~ ', localTimeError, localTime, simplifyValue.sportType);
    }


    mkdirsSync(path.join(baseDir, `json`))
    fs.writeFileSync(path.join(baseDir, `json/${localTime}.json`), JSON.stringify({
        trackList,
        simplifyValue,
        address,
        _source: 'huawei',
        startTs: motion.startTime,
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
            dLog('Extraction complete', filePath);
            resolve(findBaseDir(dir));
        } catch (err) {
            // handle any errors
            resolve();
        }
    })


}

async function generate(dirs, info) {
    const [baseDir, MOTION_FILE] = dirs;

    const jsonDirPath = path.join(baseDir, 'json');
    const isDirExist = fs.existsSync(jsonDirPath);

    if (isDirExist) {
        await pack(baseDir, info);
        return;
    }

    const motionPath = baseDir + '/' + MOTION_FILE;
    const motionList =  require(motionPath);

    for (let motion of motionList) {
        await collectData(motion, baseDir);
    }
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
