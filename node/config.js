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
    default: [1, 0], // 默认户外跑步
    258: [1, 0], // 户外跑步
    264: [1, 1], // 室内跑步机
    259: [2, 0], // 户外骑自行车
    262: [5, 17], // 游泳
    265: [2, 6], // 室内骑自行车
    129: [0, 0], // 羽毛球 -> 通用
    257: [11, 0], // 步行
    281: [11, 0], // 室内步行
    283: [10, 26], // 跳绳->有氧训练
    273: [4, 15], // 椭圆机
    274: [15, 14], // 划船机
    279: [18, 0], // 综合运动
    // 综合运动 [18, 0]
  };
  return resultMap[value] || resultMap['default'];
}

// zepp映射成跟huawei统一的，方便统一处理
function getZeppSportType(value) {
  const resultMap = {
    default: 258, // 默认Running
    1: 258, // 'Running',
    6: 257, // 'Walking',
    8: 264, // 'Running', // 室内跑步（跑步机）
    9: 259, // 'Biking',
    16: 279, // 'MultiSport', // 自由活动
  };
  return resultMap[value] || resultMap['default'];
}

// xiaomi映射成跟huawei统一的，方便统一处理
function getXiaomiSportType(value) {
  const resultMap = {
  default: 258, // 默认Running
    1: 258, // 'Running',
    9: 262, // 'Swimming',
  };
  return resultMap[value] || resultMap['default'];
}

module.exports = {
  getTcxSportType,
  getFitSportType,
  getZeppSportType,
  getXiaomiSportType,
}
