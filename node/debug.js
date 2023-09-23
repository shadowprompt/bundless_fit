const { makeFIT} = require('./tools')
function debug() {
  const job = makeFIT('/private/tmp/fit_upload/fit_1695360878808/Motion path detail data & description', '2023-06-22_13-03-56.json', 1);
  job();
}


debug();
