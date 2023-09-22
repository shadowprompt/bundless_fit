import React, { useState, useEffect } from 'react';
import { UploadOutlined } from '@ant-design/icons';
import { Button, Input, message, Upload, Divider, Radio, List } from 'antd';

import './app.scss';
function App() {
    const [type, setType] = useState('huawei');
    const [address, setAddress] = useState('');
    const [fileList, setFileList] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [importList] = useState([{
        label: '高驰',
        url: 'https://trainingcn.coros.com/admin/views/activities',
        desc: '上述入口登录后点击右上角"导入数据"'
    }, {
        label: '佳明',
        url: 'https://connect.garmin.cn/modern/import-data',
        desc: '上述入口登录后点击"导入数据"'

    }, {
        label: 'Strava',
        url: 'https://www.strava.com/upload/select',
        desc: '上述入口登录后直接导入'
    }, {
        label: 'RQrun',
        url: 'https://www.rq.run/user/upload',
        desc: '上述入口登录后在页面中下方找到"手动上传"区域'
    }, {
        label: '华为',
        url: 'https://h5hosting.dbankcdn.com/cch5/healthkit/data-import/pages/oauth-callback.html#/',
        desc: '先从右上角登录后直接导入'
    }]);
    const [updateLogList] = useState([{
        label: '2023-09-22',
        type: 'desc',
        desc: '转换结果细分运动类型：支持户外跑步、跑步机跑步（新增）、步行（新增）、户外自行车（新增）'
    }, {
    label: '2023-09-16',
      type: 'desc',
      desc: '上调支持的压缩包大小上限；优化转化逻辑，提高生成fit文件成功率'
    }, {
      label: '2023-08-18',
      type: 'desc',
      desc: '启用域名 https://convert.fit'
    }, {
        label: '2023-08-12',
        desc: '.tcx格式转换结果新增显示配速、海拔信息（仅限华为）'
    }, {
        label: '2023-08-05',
        desc: '.fit格式转换结果新增显示配速、海拔信息，显示每公里步幅（仅限华为）'
    }, {
        label: '2023-07-31',
        type: 'desc',
        desc: '页面兼容老版本浏览器'
    }, {
        label: '2023-07-30',
        desc: '.fit格式转换结果新增显示每公里距离、心率、配速（仅限华为）'
    }, {
        label: '2023-07-29',
        type: 'desc',
        desc: '显示各主要运动平台导入数据入口、本工具转换次数'
    }, {
        label: '2023-07-28',
        desc: '修正华为数据轨迹漂移问题'
    }]);


    useEffect(() => {
        const countWrapper = document.querySelector('.countWrapper');
        if (countWrapper) {
            countWrapper.style.display = '';
        }
    }, [])

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
        const targetUrl = window.location.href.includes('localhost')
            ? 'http://localhost:9000/upload'
            : window.location.search.includes('source=')
                ? '/upload'
                : 'https://convert.fit/upload';
        fetch(targetUrl, {
            method: 'POST',
            body: formData,
        })
            .then((response) => response.json())
            .then((res) => {
                if (res.success) {
                    message.success('上传成功，转换结果随后将以邮件形式通知', 5);

                } else {
                    message.error('上传压缩包结构不正确，请按照说明重新整理后上传', 5);
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
                    <p className="img-box">
                      <img src='/zip-intro-huawei.png' alt='华为压缩包结构说明' />
                    </p>
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
                    <p>放至一个文件夹内，打包成zip压缩包上传</p>
                    <p className="img-box">
                      <img src='/zip-intro-zepp.png' alt='zepp压缩包结构说明' />
                    </p>
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
                    <img src="/tool-intro.png"
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
                <p className="slogan">
                    我们只能转换运动健康数据，并不能生产健康，为了健康，运动起来吧。
                </p>
                <p>
                    将官方的导出数据解压后，选择其中的特定数据文件（具体见待上传压缩包结构说明）打包至一个新的zip压缩包，上传至本工具即可开始转换。
                </p>
                <p>
                    待转换成功后您会收到一封来自<b>JustNotify@qq.com</b>的邮件，该邮件会含有一个转换结果压缩包的下载地址。
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
                    <div className="upload-intro">更多说明可以参考<a href="https://www.toutiao.com/article/7260290208145637929/" target="_blank" rel="noreferrer">华为、小米运动记录转fit和tcx格式工具转换效果展示及使用教程</a></div>
                </div>

                <Divider>3. 上传数据</Divider>

                <div className="upload-box">
                    <Upload onRemove={onRemove} beforeUpload={beforeUpload} fileList={fileList} accept="zip" maxCount={1}>
                        <Button icon={<UploadOutlined />}>选择文件</Button>
                    </Upload>

                    {
                        (fileList.length === 0 || !address) && (
                            <div>
                                {
                                    (!address) && (
                                        <div style={{color: "red"}}>邮箱地址别忘了填写哦，转换结果需要通过邮箱发送</div>
                                    )
                                }
                            </div>
                        )
                    }
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
            <Divider plain={true}>如果本工具解决了您的难题，可以给我加🍗哦。</Divider>
            <div className="img-box">
                <img className="zfb" src="/zfb.png"
                     title="转换格式" alt=""/>
            </div>
            <div className="toutiao-box">
              <div className="toutiao-des">欢迎来<span className="highlight">今日头条</span>关注支持我</div>
              <img className="zfb" src="/qrcode.png"
                   title="锅巴瓜子 今日头条" alt=""/>
            </div>
            <Divider>解压后文件夹命名规则说明</Divider>
            <div className="app-logo">
                <div className="img-box">
                    <img src="/type-intro.png"
                         title="运动类型说明" alt=""/>
                </div>
            </div>
            <Divider orientation="left">主流运动平台导入数据入口</Divider>
            <List
                size="small"
                bordered
                dataSource={importList}
                renderItem={(item) => (
                    <List.Item>
                        <List.Item.Meta
                            title={(
                                <span>
                                    <span>{item.label}</span>
                                    <span><a href={item.url} target="_blank" rel="noreferrer">导入数据入口</a></span>
                                </span>
                            )}
                            description={item.desc}
                        />
                    </List.Item>
                )}
            />
            <Divider orientation="left">更新日志</Divider>
            <List
                size="small"
                bordered
                dataSource={updateLogList}
                renderItem={(item) => (
                    <List.Item>
                        <List.Item.Meta
                            title={<span>{item.label}</span>}
                            description={ item.type ? (item.desc) : (<span className='important_text'>{item.desc}</span>)}
                        />
                    </List.Item>
                )}
            />
        </div>
    );
}

export default App;
