import * as path from 'path';
import * as webpack from 'webpack';

import { WriteAssetsToDiskWebpackPlugin } from '../../plugins/write-assets-to-disk-webpack-plugin';
import { WriteStatsJsonWebpackPlugin } from '../../plugins/write-stats-json-webpack-plugin';

import { AngularBuildContext, AppProjectConfigInternal } from '../../build-context';
import { InternalError, InvalidConfigError } from '../../error-models';
import { getCustomWebpackConfig, outputHashFormat, resolveLoaderPath } from '../../helpers';

import { getAngularFixPlugins } from './angular';
import { getAppCommonWebpackConfigPartial } from './common';
import { getAppStylesWebpackConfigPartial } from './styles';

const webpackMerge = require('webpack-merge');

export function
    getAppDllWebpackConfig<TConfig extends AppProjectConfigInternal>(angularBuildContext: AngularBuildContext<TConfig>):
    webpack.Configuration {
    const appConfig = angularBuildContext.projectConfig as AppProjectConfigInternal;
    let customWebpackConfig: webpack.Configuration = {};

    if (!appConfig._isDll || angularBuildContext.projectConfig._projectType !== 'app') {
        return {};
    }

    if (appConfig.webpackConfig) {
        const customWebpackConfigPath =
            path.resolve(AngularBuildContext.workspaceRoot, appConfig.root || '', appConfig.webpackConfig);
        customWebpackConfig =
            getCustomWebpackConfig(customWebpackConfigPath, angularBuildContext) || {};
    }

    const configs: webpack.Configuration[] = [
        getAppCommonWebpackConfigPartial(angularBuildContext),
        getAppStylesWebpackConfigPartial(angularBuildContext),
        getAppDllWebpackConfigPartial(angularBuildContext),
        customWebpackConfig
    ];

    const mergedConfig = webpackMerge(configs) as webpack.Configuration;
    if (!mergedConfig.entry || (typeof mergedConfig.entry === 'object' && !Object.keys(mergedConfig.entry).length)) {
        mergedConfig.entry = (() => ({})) as any;
    }

    return mergedConfig;
}

function getAppDllWebpackConfigPartial<TConfig extends AppProjectConfigInternal>(angularBuildContext:
    AngularBuildContext<TConfig>): webpack.Configuration {
    const logLevel = angularBuildContext.buildOptions.logLevel;

    const appConfig = angularBuildContext.projectConfig as AppProjectConfigInternal;

    if (!appConfig.outputPath) {
        throw new InvalidConfigError(
            `The 'projects[${angularBuildContext.projectConfig.name || angularBuildContext.projectConfig._index
            }].outputPath' value is required.`);
    }

    const projectRoot = path.resolve(AngularBuildContext.workspaceRoot, appConfig.root || '');
    const outputPath = path.resolve(AngularBuildContext.workspaceRoot, appConfig.outputPath);

    // TODO: to review for hash
    const libHashFormat = (!appConfig.platformTarget || appConfig.platformTarget === 'web') &&
        appConfig._outputHashing &&
        appConfig._outputHashing.bundles
        ? outputHashFormat.bundle
        : '';

    const libraryName = `[name]_${libHashFormat || 'lib'}`;
    const vendorChunkName = appConfig.vendorChunkName || 'vendor';

    const entryPoints: { [key: string]: string[] } = {};
    const tsEntries: any[] = [];
    const entries: string[] = [];

    // dll
    if (appConfig.dlls) {
        if (!appConfig._dllParsedResult) {
            throw new InternalError("The 'appConfig._dllParsedResult' is not set");
        }
        const dllResult = appConfig._dllParsedResult;
        dllResult.tsEntries.forEach(tsEntry => {
            if (!tsEntries.includes(tsEntry)) {
                tsEntries.push(tsEntry);
            }
            if (!entries.includes(tsEntry)) {
                entries.push(tsEntry);
            }
        });
        dllResult.scriptEntries.forEach(scriptEntry => {
            if (!entries.includes(scriptEntry)) {
                entries.push(scriptEntry);
            }
        });
        dllResult.styleEntries.forEach(styleEntry => {
            if (!entries.includes(styleEntry)) {
                entries.push(styleEntry);
            }
        });
    }

    if (!entries.length) {
        throw new InvalidConfigError(
            `No entry available in 'apps[${angularBuildContext.projectConfig._index
            }].dll'.`);
    }

    entryPoints[vendorChunkName] = entries;

    const rules: webpack.Rule[] = [];

    // plugins
    const plugins: webpack.Plugin[] = [
        new webpack.DllPlugin({
            context: projectRoot,
            path: path.resolve(outputPath, `${vendorChunkName}-manifest.json`),
            name: libraryName
        }),
        new WriteStatsJsonWebpackPlugin({
            outputPath: outputPath,
            path: path.resolve(outputPath, `${vendorChunkName}-assets.json`),
            forceWriteToDisk: true,
            loggerOptions: {
                logLevel: logLevel
            }
        }),
        new WriteAssetsToDiskWebpackPlugin({
            outputPath: outputPath,
            emittedPaths: [path.resolve(outputPath, `${vendorChunkName}-manifest.json`)],
            exclude: [`${vendorChunkName}-assets.json`],
            loggerOptions: {
                logLevel: logLevel
            }
        })
    ];

    if (tsEntries.length > 0) {
        const tsConfigPath = appConfig._tsConfigPath;
        const tsLoaderOptions: { [key: string]: any } = {
            instance: `at-${appConfig.name || 'apps[' + appConfig._index + ']'}-loader`,
            transpileOnly: appConfig.tsConfig ? false : true,
            onlyCompileBundledFiles: appConfig.tsConfig ? false : true,
            silent: logLevel !== 'debug'
        };

        if (appConfig.tsConfig && tsConfigPath) {
            tsLoaderOptions.configFile = tsConfigPath;
        }
        if (logLevel) {
            tsLoaderOptions.logLevel = logLevel;
        }

        const tsLoader = resolveLoaderPath('ts-loader');

        rules.push({
            test: /\.ts$/,
            use: [
                {
                    loader: tsLoader,
                    options: tsLoaderOptions
                }
            ],
            include: tsEntries
        });
    }

    // es6-promise
    // workaround for https://github.com/stefanpenner/es6-promise/issues/100
    plugins.push(new webpack.IgnorePlugin(/^vertx$/));

    // workaround for https://github.com/andris9/encoding/issues/16
    // commonPlugins.push(new webpack.NormalModuleReplacementPlugin(/\/iconv-loader$/, require.resolve('node-noop'))));

    // angular fix plugins
    plugins.push(...getAngularFixPlugins(angularBuildContext));

    // webpack config
    const webpackDllConfig: webpack.Configuration = {
        entry: entryPoints,
        resolve: {
            extensions: tsEntries.length > 0 ? ['.ts', '.js'] : ['.js'],
        },
        output: {
            publicPath: appConfig.publicPath || '/',
            library: libraryName
        },
        module: {
            rules: rules
        },
        plugins: plugins
    };

    return webpackDllConfig;
}
