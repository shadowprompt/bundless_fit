// 从网上找到的零星数据，可能不全
function getTcxSportType(value) {
  const resultMap = {
    default: 'Running', // 默认户外跑步
    257: 'Walking', // 户外步行
    258: 'Running', // 户外跑步
    259: 'Biking', // 骑自行车
    262: 'Swimming', // 游泳
    264: 'Running', // Treadmill 室内跑步（跑步机）
    265: 'IndoorBike', // 室内骑自行车
    // 273: 'CrossTrainer ', // 椭圆机
    274: 'RowMachine', // 划船机
    // 290: 'Rower', // 划船机划水模式
    // 291: 'Rowerstrength', // 划船机力量模式
    279: 'MultiSport', // 综合运动 不好归类的都在此类
    281: 'Walking', // 室内步行
    283: 'RopeSkipping', // 跳绳
    129: 'Badminton', // 羽毛球
  };
  return resultMap[value] || resultMap['default'];
}

function getFitSportType(value) {
  const resultMap = {
    default: [18, 0], // 默认综合运动
    258: [1, 0], // 户外跑步
    264: [1, 1], // 室内跑步机
    259: [2, 0], // 户外骑自行车
    262: [5, 17], // 游泳
    265: [2, 6], // 室内骑自行车
    // 129: [0, 0], // 羽毛球 -> 通用
    257: [11, 0], // 步行
    281: [11, 0], // 室内步行
    283: [10, 26], // 跳绳->有氧训练
    273: [4, 15], // 椭圆机
    274: [15, 14], // 划船机
    279: [18, 0], // 综合运动
  };
  return resultMap[value] || resultMap['default'];
}

// zepp映射成跟huawei统一的，方便统一处理
function getZeppSportType(value) {
  const resultMap = {
    default: 279, // 默认MultiSport
    1: 258, // 'Running', // 户外跑步
    6: 257, // 'Walking',
    8: 264, // 'Running', // 室内跑步（跑步机）
    9: 259, // 'Biking', // 户外骑自行车
    16: 279, // 'MultiSport', // 自由活动
  };
  return resultMap[value] || resultMap['default'];
}

// xiaomi映射成跟huawei统一的，方便统一处理
function getXiaomiSportType(sportType, protoType) {
  const value = `_${sportType}_${protoType}`;
  const resultMap = {
    default: 279, // 默认MultiSport
    _1_1: 258, // 'outdoor_running',
    _2_2: 257, // 'outdoor_walking',
    _3_3: 264, // 'indoor_running',
    // _4_4: 258, // 'climbing',
    _5_5: 257, // 'cross_hiking', // 越野徒步->户外步行
    // _8_8: 258, // 'free_training',
    _9_9: 262, // 'Swimming',
    // _14_14: 283, // 'rop_skipping',
    // _16_16: 258, // 'high_interval_training',
    // _608_8: 129, // 'badminton',
    // _300_8: 258, // 'climbing_machine',
    // _303_8: 258, // 'core_training',
    // _307_8: 258, // 'strength',
    // _308_8: 258, // 'strength_training',
    // _312_8: 258, // 'lower_limb_training',
    // _313_8: 258, // 'dumbbell_training',
    // _319_8: 258, // 'functional_training',
    // _322_8: 258, // 'waist_training',
    // _406_8: 258, // 'jazz',
  };
  return resultMap[value] || resultMap['default'];
}

module.exports = {
  getTcxSportType,
  getFitSportType,
  getZeppSportType,
  getXiaomiSportType,
}
