const express = require('express')
const path = require('path')
const multer = require('multer');
const fs = require("fs");
const cors = require('cors');
const ejs = require('ejs');
const { dLog, nodeStore } = require('@daozhao/utils');
const {mkdirsSync} = require("./node/tools");

mkdirsSync('/tmp/fit_upload_temp');
const upload = multer({ dest: '/tmp/fit_upload_temp/' });
const huaweiHandler = require('./node/huaweiHandler');
const zeppHandler = require('./node/zeppHandler');
const localStorage = nodeStore('../localStorage/bundless_fit');
const app = express();

app.use(cors())
app.set('views', __dirname + '/build'); // 修改ejs模板查找文件夹
app.engine('html', ejs.__express); // 修改默认的模板后缀为.html
app.use(express.static('/tmp'));
app.get('/', (req, res) => {
  let prevList = localStorage.getItem('list') || '[]';
  prevList = JSON.parse(prevList);
  const data = {
    count:  prevList.length + 50,
  };
  res.render('index.html', data);
});
app.use(express.static(path.join(__dirname, '../bundless_fit/build'))); // 直接读取bundless_fit web打包后的文件夹
app.use(express.static(path.join(__dirname, './build'))); // 直接读取bundless_fit web打包后的文件夹
// Routes
app.get(`/`, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})


app.post('/upload', upload.array('zip_file', 1), function(req,res){
  const requestBody =  req.body || {};
  const address = requestBody.address;
  const type = requestBody.type;
  const ts = Date.now();
  const fileName = 'fit_' + ts;

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
  mkdirsSync('/tmp/fit_upload_temp');

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
      const baseFilePath = `/tmp/fit_upload`;
      mkdirsSync(baseFilePath);
      const targetPath= `${baseFilePath}/${fileName}.${ext}`;
      //使用同步方式重命名一个文件
      fs.renameSync(file.path, targetPath);
      dLog('successfully rename the file to ', file.path, targetPath, type);
      const handler = type === 'huawei' ? huaweiHandler : zeppHandler;
      return handler.preCheck(targetPath).then(result => {
        const baseUrl = `https://fit.bundless.cn/fit_upload/${fileName}`;

        Promise.resolve().then(() => {
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
              }
            }
          })
        })

        res.send({
          success: !!result,
        });
      })
    }
  }
});

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
