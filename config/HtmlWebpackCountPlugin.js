const HtmlWebpackPlugin = require('html-webpack-plugin');

class HtmlWebpackCountPlugin {
    text = ''

    constructor(text) {
        this.text = `${text}\n`
    }

    apply(compiler) {
        compiler.hooks.compilation.tap(
            'HtmlWebpackCountPlugin',
            (compilation, callback) => {
                HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tapAsync(
                    'HtmlWebpackCountPlugin', // Set a meaningful name here for stack traces
                    (htmlPluginData, callback) => {
                        htmlPluginData.html = htmlPluginData.html.replace('<div id="root"></div>', `<div id="root"></div>${this.text}`);
                        callback(null, htmlPluginData);
                    }
                );
            })
    }
}

module.exports = HtmlWebpackCountPlugin;