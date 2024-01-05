const papaparse = require('papaparse');
function readCsv(filePath){
  papaparse.parse(filePath, {
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
