import React, { useState } from 'react';
import { UploadOutlined } from '@ant-design/icons';
import { Button, Input, message, Upload, Divider, Radio } from 'antd';

import './app.scss';
function App() {
    const [type, setType] = useState('huawei');
    const [address, setAddress] = useState('');
    const [fileList, setFileList] = useState([]);
    const [uploading, setUploading] = useState(false);

    const onAddressChange = (e) => {
        setAddress(e.target.value);
    };
    const onTypeChange = (e) => {
        setType(e.target.value);
    };
    const handleUpload = () => {
        const formData = new FormData();
        fileList.forEach((file) => {
            formData.append('zip_file', file);
        });
        formData.append('type', type);
        formData.append('address', address);
        setUploading(true);
        // const targetUrl = 'https://fit.bundless.cn/upload';
        const targetUrl = '/upload';
        fetch(targetUrl, {
            method: 'POST',
            body: formData,
        })
            .then((response) => response.json())
            .then((res) => {
                if (res.success) {
                    message.success('上传成功，转换结果随后将以邮件形式通知');

                } else {
                    message.error('上传文件格式不正确，请按照说明重新上传压缩包');
                }
                setFileList([]);
            })
            .catch((err) => {
                console.log('err', err);
                message.error('上传出错');
            })
            .finally(() => {
                setUploading(false);
            });
    };

    const onRemove = (file) => {
        const index = fileList.indexOf(file);
        const newFileList = fileList.slice();
        newFileList.splice(index, 1);
        setFileList(newFileList);
    };
    const beforeUpload = (file) => {
        setFileList([...fileList, file]);
        return false;
    };
    
    const typeRender = (type) => {
        if (type === 'huawei') {
            return (
                <div className="upload-desc-huawei">
                    <p>将华为官网导出数据解压（可能需要密码）至文件夹</p>
                    <p>将该文件夹中的以下文件</p>
                    <p className="sub"><b>Motion path detail data & description/motion path detail data.json</b></p>
                    <p>放至一个文件夹内，打包成zip压缩包上传</p>
                </div>
            );
        } else if (type === 'zepp') {
            return (
                <div className="upload-desc-zepp">
                    <p>将zepp官网导出数据解压（可能需要密码）至文件夹</p>
                    <p>将该文件夹中的以下文件</p>
                    <p className="sub"><b>SPORT/SPOR_xxx.csv</b></p>
                    <p className="sub"><b>HEARTRATE_AUTO/HEARTRATE_AUTO_xxx.csv</b></p>
                    <p className="sub"><b>ACTIVITY_MINUTE/ACTIVITY_MINUTE_xxx.csv</b></p>
                    <p className="sub"><b>ACTIVITY_STAGE_FILE/ACTIVITY_STAGE_FILE_xxx.csv</b></p>
                    <p>放至一个文件夹内，打包成zip压缩包上传</p>
                </div>
            );
        }
    }

    return (
        <div className="App">
            <header className="app-header">

            </header>
            <div className="app-logo">
                <div className="img-box">
                    <img src="https://p3-sign.toutiaoimg.com/tos-cn-i-qvj2lq49k0/87619a6292d54235bea51825c3f3bb9d~tplv-obj:500:500.image?_iz=97245&from=post&x-expires=1697932800&x-signature=SxteyYanO5kWU08vdsV7MgzEhG8%3D"
                         title="转换格式" alt=""/>
                </div>
            </div>
            <div className="app-intro">
                <p className="slogan">
                    每一次运动锻炼了我们的身体，值得留存在我们的记录里，不负每一滴汗水，尊重每一次付出。
                </p>
                <p>
                    本工具旨在为各位跑友转换运动记录数据，支持将<b>华为运动健康</b>、<b>Zepp Life（原小米运动）</b>官方导出的运动数据转换成业内通用的fit（推荐）或tcx格式，然后即可顺利导入主流的运动平台，比如高驰、佳明、RQrun、Strava等。
                </p>
                <p>
                    将官方的导出数据解压后，选择其中的特定数据文件（具体见待上传压缩包结构说明）打包至一个新的zip压缩包，上传至本工具即可开始转换。
                </p>
                <p>
                    待转换成功后您会收到一封来自<b>justnotify@qq.com</b>的邮件，该邮件会含有一个转换结果压缩包的下载地址。
                </p>
                <p>
                    该压缩包内含有转换后的fit和tcx格式数据，每条运动记录对应一个文件。
                </p>
            </div>
            <Divider>1. 请输入接收结果的邮箱</Divider>
            <div className="upload-address">
                <Input placeholder="转换结果将以邮件形式通知" value={address} onChange={onAddressChange}/>

            </div>
            <Divider>2. 请选择正确的数据类型</Divider>
            <section className="app-content">
                <div className="upload-type">
                    <Radio.Group onChange={onTypeChange} value={type}>
                        <Radio value="huawei">华为运动健康</Radio>
                        <Radio value="zepp">Zepp Life（原小米运动）</Radio>
                    </Radio.Group>
                </div>
                <Divider orientation="left" plain>待上传压缩包结构说明</Divider>
                <div className="upload-desc">
                    { typeRender(type) }
                    <div className="upload-intro">更多说明可以参考</div>
                </div>

                <Divider>3. 上传数据</Divider>

                <div className="upload-box">
                    <Upload onRemove={onRemove} beforeUpload={beforeUpload} fileList={fileList} accept="zip" maxCount={1}>
                        <Button icon={<UploadOutlined />}>选择文件</Button>
                    </Upload>
                    <Button
                        type="primary"
                        onClick={handleUpload}
                        disabled={fileList.length === 0 || !address}
                        loading={uploading}
                        style={{
                            marginTop: 16,
                        }}
                    >
                        {uploading ? '正在上传' : '确认上传'}
                    </Button>
                </div>
            </section>
            <Divider plain={true}>如果本工具对您有帮助，可以选择给我打赏哦</Divider>
            <div className="img-box">
                <img className="zfb" src="/zfb.png"
                     title="转换格式" alt=""/>
            </div>
            <Divider plain={true}><a href="https://beian.miit.gov.cn/" target="_blank" title="鄂ICP备2020023502号-2" rel="noreferrer" >鄂ICP备2020023502号-2</a></Divider>
        </div>
    );
}

export default App;
