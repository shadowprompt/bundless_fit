const express = require('express')
const path = require('path')
const multer = require('multer');
const fs = require("fs");
const os = require("os");
const cors = require('cors');
const ejs = require('ejs');
const { dLog, nodeStore } = require('@daozhao/utils');
const {mkdirsSync, checkLock, releaseLock, setLock} = require("./node/tools");

const ROOT_PATH = os.platform() === 'win32' ? 'D:/Dev': '/tmp';
const UPLOAD_PATH = `${ROOT_PATH}/fit_upload`;
const UPLOAD_TEMP_PATH = `${ROOT_PATH}/fit_upload_temp`;

mkdirsSync(UPLOAD_TEMP_PATH);
const upload = multer({ dest: UPLOAD_TEMP_PATH });
const huaweiHandler = require('./node/huaweiHandler');
const zeppHandler = require('./node/zeppHandler');
const localStorage = nodeStore('../localStorage/bundless_fit');
const app = express();

app.use(cors())
app.set('views', __dirname + '/build'); // 修改ejs模板查找文件夹
app.engine('html', ejs.__express); // 修改默认的模板后缀为.html
app.use(express.static(ROOT_PATH));
app.get('/', (req, res) => {
  let prevList = localStorage.getItem('list') || '[]';
  prevList = JSON.parse(prevList);
  const successList = prevList.filter(item => item.status === 'success');
  const data = {
    count:  prevList.length + 50,
    successCount: successList.length + 50,
  };
  res.render('index.html', data);
});
app.use(express.static(path.join(__dirname, './build'))); // 直接读取bundless_fit web打包后的文件夹
// Routes
app.get(`/`, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

releaseLock();
app.post('/upload', upload.array('zip_file', 1), function(req,res){
  const requestBody =  req.body || {};
  const address = requestBody.address;
  const type = requestBody.type;
  const ts = Date.now();
  const fileName = 'fit_' + ts;
  dLog('log upload ', fileName, `[${address} ${type}]` );
  // code -1:有任务正在执行 1:预检通过 0:预检不通过
  if (checkLock()) {
    res.send({
      code: -1,
    });
    return;
  } else {
    setLock(`[${address} ${type}] ${new Date().toString()}`);
  }

  let prevList = localStorage.getItem('list') || '[]';
  prevList = JSON.parse(prevList);
  localStorage.setItem('list', JSON.stringify([
    ...prevList,
    {
      address,
      type,
      fileName,
      ts,
    }
  ]));
  mkdirsSync(UPLOAD_TEMP_PATH);

  for(let i in req.files){
    const file = req.files[i];
    if(file.size === 0){
      //使用同步方式删除一个文件
      fs.unlinkSync(file.path);
      dLog("successfully removed an empty file");
    }else{
      const originalName = file.originalname;
      const list = originalName.split('.');
      const ext = list[list.length - 1];
      const baseFilePath = UPLOAD_PATH;
      mkdirsSync(baseFilePath);
      const targetPath= `${baseFilePath}/${fileName}.${ext}`;
      //使用同步方式重命名一个文件
      fs.renameSync(file.path, targetPath);
      dLog('log rename success ', file.path, targetPath, `[${address} ${type}]` );
      const handler = type === 'huawei' ? huaweiHandler : zeppHandler;
      // 根据preCheck是否返回目录结果开判断压缩包的内容是否正确
      return handler.preCheck(targetPath).then(dirs => {

        dLog('log preCheck ', dirs ? 'success': 'fail', file.path, file.size, targetPath, `[${address} ${type}]` );
        res.send({
          code: dirs ? 1 : 0,
        });
        // 预检通过则直接进行解析流程
        if (dirs) {
          const baseUrl = `https://convert.fit/fit_upload/${fileName}`;

          handler.parser({
            data: {
              requestBody: {
                info: {
                  address,
                  type,
                  baseFilePath,
                  filePath: targetPath,
                  baseUrl,
                  fileName,
                }
              },
              dirs,
            }
          })
        } else {
          releaseLock();
        }
      })
    }
  }
});

// 重置任务正在执行标志位
app.get('/reset', (req, res) => {
  releaseLock();
  res.send({
    code: checkLock() ? 1 : 0,
  });
})

app.get('/404', (req, res) => {
  res.status(404).send('Not found')
})

app.get('/500', (req, res) => {
  res.status(500).send('Server Error')
})

// Error handler
app.use(function(err, req, res, next) {
  console.error(err)
  res.status(500).send('Internal Serverless Error')
})

app.listen(9000, () => {
  dLog(`Server start on http://localhost:9000`);
})


process.on('error', (err) => {
  dLog('process error ', err);
  releaseLock();
})

process.on('exit', (err) => {
  dLog('process exit ', err);
  releaseLock();
})

process.on('unhandledrejection', (err) => {
  dLog('process unhandledrejection ', err);
  releaseLock();
})
