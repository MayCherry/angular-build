﻿import * as fs from 'fs';
// ReSharper disable once CommonJsExternalModule
const webpack = require('webpack');

const webpackOutputOptions = {
    colors: true,
    hash: true,
    timings: true,
    chunks: true,
    chunkModules: false,
    children: false, // listing all children is very noisy in AOT and hides warnings/errors
    modules: false,
    reasons: false,
    warnings: true,
    assets: false, // listing all assets is very noisy when using assets directories
    version: false
};

const verboseWebpackOutputOptions = {
    children: true,
    assets: true,
    version: true,
    reasons: true,
    chunkModules: false // TODO: set to true when console to file output is fixed
};

function getWebpackStatsConfig(verbose = false) {
    return verbose
        ? Object.assign(webpackOutputOptions, verboseWebpackOutputOptions)
        : webpackOutputOptions;
}


export interface TryBundleDllPluginOptions {
    manifestFile: string;
    webpackDllConfig: any;
    debug?: boolean;
}

export class TryBundleDllWebpackPlugin {

    constructor(private readonly options: TryBundleDllPluginOptions) {
    }

    apply(compiler: any) {
        compiler.plugin('run', (c: any, next: any) => this.tryDll(next));
        compiler.plugin('watch-run', (c: any, next: any) => this.tryDll(next));
    }


    tryDll(next: (err?: Error) => any): void {
        this.checkManifestFile()
            .then((exists: boolean) => {
                if (exists) {
                    return Promise.resolve(null);
                } else {
                    const webpackDllConfig = this.options.webpackDllConfig;
                    const webpackCompiler: any = webpack(webpackDllConfig);
                    const statsConfig = getWebpackStatsConfig(this.options.debug);

                    return new Promise((resolve, reject) => {
                        const callback = (err: any, stats: any) => {
                            if (err) {
                                return reject(err);
                            }

                            console.info(stats.toString(statsConfig));

                            // TODO:
                            //if (watch) {
                            //  return;
                            //}

                            if (stats.hasErrors()) {
                                reject();
                            } else {
                                resolve();
                            }
                        };

                        webpackCompiler.run(callback);
                        // TODO:
                        //if (watch) {
                        //  webpackCompiler.watch({}, callback);
                        //} else {
                        //  webpackCompiler.run(callback);
                        //}
                    });
                }
            })
            .then(() => next())
            .catch((err: Error) => next(err));
    }

    private checkManifestFile() {
        return new Promise((resolve, reject) => {
            return fs.stat(this.options.manifestFile, (err, stats) => {
                if (err) {
                    return reject(err);
                }
                return resolve(stats.isFile());
            });
        });
    }

}