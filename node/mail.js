const nodemailer = require('nodemailer');
const { zip } = require('zip-a-folder');
const extract = require('extract-zip')
const { dLog } = require('@daozhao/utils');

const typeMap= {
    sina: { // 失败 535
        host: 'smtp.sina.com',
        port: 25,
        auth: {
            user: 'jinicgood@sina.com', // generated ethereal user
            pass: '91abc44076466e43'  // generated ethereal password
        },
    },
    qq: {
        host: 'smtp.qq.com',
        port: 465,
        secure: true, // true for 465, false for other ports
        auth: {
            user: 'justnotify@qq.com', // generated ethereal user
            pass: 'pyivercyedysbjjb'  // generated ethereal password
        },
    }
}

function sendMail(type, msg) {
    const config = typeMap[type] || typeMap['qq'];
    nodemailer.createTestAccount((err, account) => {
        // create reusable transporter object using the default SMTP transport
        // dLog('account', account);
        let transporter = nodemailer.createTransport({
            ...config
        });

        const message = {
            from: config.from,
            ...msg,
        };

        transporter.sendMail(message).then(info=>{
            dLog('Preview URL: ' + nodemailer.getTestMessageUrl(info));
        }).catch(err => {
            dLog('send error', err);
        });
    });
}

async function extractZip() {
    try {
        await extract('/Users/shadow/Desktop/aFit.zip', { dir: '/Users/shadow/Desktop/aFit' })
        dLog('Extraction complete')
    } catch (err) {
        // handle any errors
    }
}

function makeZip(...rest) {
    return zip(...rest);
}

// extractZip()

module.exports = {
    sendMail,
    makeZip,
}