const fs = require('fs');
const csv = require('csv-parser');
function readCsv(filePath){
  const results = [];
  let i = 0;
  let mode;
  return new Promise((resolve) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
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
      })
      .on('end', () => {
        console.log('end ~ ', results.length, mode);
        if (mode === 'desc') {
          resolve(results.reverse());
        } else {
          resolve(results);
        }
      });
  });
}

module.exports = {
  readCsv,
}
