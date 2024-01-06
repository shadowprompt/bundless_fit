const fs = require('fs');
const papaparse = require('papaparse');
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
        if (mode === 'desc') {
          results.unshift(data);
        } else if (mode === 'asc') {
          results.push(data);
        } else {
          const prev = results[i - 1];
          if (prev) {
            if (prev.Time > data.Time) {
              mode = 'desc';
              results.unshift(data);
            } else if (prev.Time < data.Time) {
              mode = 'asc';
              results.push(data);
            } else { // 相等时无法判断，留给下一次再判断
              results.push(data);
            }
          } else {
            results.push(data);
          }
        }

        if (i % 50000 === 0) {
          console.log('i ~ ', i, mode);
        }
        i++;
      })
      .on('end', () => {
        console.log('end ~ ', results.length);
        resolve(results);
      });
  });

  const file = fs.readFileSync(filePath);
  papaparse.parse(file, {
    "delimiter":",",
    "header":false,
    "dynamicTyping":false,
    "skipEmptyLines":false,
    "preview":0,
    "encoding":"",
    "worker":false,
    "comments":"",
    "download":false,
    step: function(results, parser) {
      console.log('step', results);
    },
    complete: function(results) {
      console.log('complete', results);
    }
  });
}

module.exports = {
  readCsv,
}
