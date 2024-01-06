const os = require('os');
const { makeFIT, mkdirsSync, pack} = require('./tools');
const { parser } = require('./xiaomiHandler');

// function debug() {
//   const job = makeFIT('/private/tmp/fit_upload/fit_1695360878808/Motion path detail data & description', '2023-06-22_13-03-56.json', 1);
//   job();
// }
//
//
// debug();

const ROOT_PATH = os.platform() === 'win32' ? 'D:/Dev': '/tmp';
const UPLOAD_PATH = `${ROOT_PATH}/fit_upload`;
function debugXiaomiParser() {
  const fileName = 'fit_' + Date.now();
  const baseFilePath = 'D:/Dev/原始数据/anyang_xiaomi/anyang';
  mkdirsSync(baseFilePath + '/' + fileName);

  const evt = {
    data: {
      requestBody: {
        info: {
          baseFilePath,
          fileName,
        }
      },
      dirs: [
        'D:/Dev/原始数据/anyang_xiaomi/anyang',
        '20231221_1068264996_MiFitness_hlth_center_sport_record.csv',
        '20231221_1068264996_MiFitness_hlth_center_fitness_data.csv',
      ]
    }
  }
  parser(evt);
}

// debugXiaomiParser();

function debugPack() {
  const fileName = 'fit_' + Date.now();
  const baseFilePath = 'D:/Dev/原始数据/debug';
  pack(baseFilePath, {
    address: 'address',
    type: 'xiaomi',
    payment: 'alipay',
    paid: 5,
    fileName,
    destination: 'huawei',
  });
}

debugPack();
