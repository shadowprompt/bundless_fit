const fs = require('fs');
const csvParser = require('csv-parser');
function readCsv(filePath){
  const results = [];
  let i = 0;
  let mode;
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath).pipe(csvParser());

    stream.on('data', (data) => {
      if (!/^1/.test(data.Time)) {
        return;
      }
      // 判断当前是顺序还是倒序
      if (!mode) {
        const prev = results[i - 1];
        if (prev) {
          // 只有能显示判断顺序还是倒序才标记mode
          if (prev.Time > data.Time) {
            mode = 'desc';
          } else if (prev.Time < data.Time) {
            mode = 'asc';
          }
        }
      }
      results.push(data);

      if (i % 50000 === 0) {
        console.log('i ~ ', i, mode);
      }
      i++;
    });

    stream.on('end', () => {
      console.log('end ~ ', filePath, results.length, mode);
      if (mode === 'desc') {
        resolve(results.reverse());
      } else {
        resolve(results);
      }
    });
  });
}


function listCompareFnDefault(startDataItem, endDataItem) {
  return 'asc';
}

function getListOrderInfo(list, compareFn = listCompareFnDefault) {
  const startNum = 0;
  const endNum = list.length - 1;
  const startData = list[startNum];
  const endData = list[endNum];
  const mode = compareFn(startData, endData);
  return {
    startNum,
    endNum,
    ascOffset: mode === 'desc' ? startNum + endNum : 0,
  }
}

module.exports = {
  readCsv,
  getListOrderInfo,
}
