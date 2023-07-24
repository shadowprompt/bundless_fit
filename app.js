const express = require('express')
const path = require('path')
const multer = require('multer');
const fs = require("fs");
const cors = require('cors');
const {mkdirsSync} = require("./tools");

mkdirsSync('/tmp/fit_upload_temp');
const upload = multer({ dest: '/tmp/fit_upload_temp/' });
const huaweiParser = require('./huaweiParser');
const app = express()

app.use(cors())

app.use(express.static('/tmp'));
app.use(express.static(path.join(__dirname, '../bundless_fit/build'))); // 直接读取bundless_fit web打包后的文件夹
app.use(express.static(path.join(__dirname, './build'))); // 直接读取bundless_fit web打包后的文件夹
// Routes
app.get(`/`, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})


app.post('/upload', upload.array('zip_file', 1), function(req,res){
  mkdirsSync('/tmp/fit_upload_temp');

  for(let i in req.files){
    const file = req.files[i];
    if(file.size === 0){
      //使用同步方式删除一个文件
      fs.unlinkSync(file.path);
      console.log("successfully removed an empty file");
    }else{
      const originalName = file.originalname;
      const list = originalName.split('.');
      const ext = list[list.length - 1];
      const ts = 'file_' + Date.now();
      const baseFilePath = `/tmp/fit_upload`;
      mkdirsSync(baseFilePath);
      const targetPath= `${baseFilePath}/${ts}.${ext}`;
      //使用同步方式重命名一个文件
      fs.renameSync(file.path, targetPath);
      console.log('successfully rename the file to ', file.path, targetPath);
      return huaweiParser.preCheck(targetPath).then(result => {
        const baseUrl = `https://fit.bundless.cn/fit_upload/${ts}`;

        Promise.resolve().then(() => {
          huaweiParser.parser({
            data: {
              requestBody: {
                address: req.body.address,
                info: {
                  baseFilePath,
                  filePath: targetPath,
                  baseUrl,
                  fileName: ts,
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
  console.log(`Server start on http://localhost:9000`);
})
