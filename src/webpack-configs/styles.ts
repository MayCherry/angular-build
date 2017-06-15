﻿import * as path from 'path';
import * as webpack from 'webpack';

import * as autoprefixer from 'autoprefixer';
import * as ExtractTextPlugin from 'extract-text-webpack-plugin';

// ReSharper disable CommonJsExternalModule
const cssnano = require('cssnano');
const postcssUrl = require('postcss-url');
// ReSharper restore CommonJsExternalModule

// internal plugins
import { SuppressEntryChunksWebpackPlugin } from '../plugins/suppress-entry-chunks-webpack-plugin';

import { parseStyleEntry, StyleParsedEntry } from '../helpers';
import { AppProjectConfig, ProjectConfig } from '../models';

import { WebpackConfigOptions } from './webpack-config-options';

/**
 * Enumerate loaders and their dependencies from this file to let the dependency validator
 * know they are used.
 * require('css-loader')
 * require('exports-loader')
 * require('less')
 * require('less-loader')
 * require('node-sass')
 * require('raw-loader')
 * require('postcss-loader')
 * require('sass-loader')
 * require('style-loader')
 * require('to-string-loader')
 */

// Ref: https://github.com/angular/angular-cli
export function getStylesConfigPartial(webpackConfigOptions: WebpackConfigOptions): webpack.Configuration {
    const projectRoot = webpackConfigOptions.projectRoot;
    const buildOptions = webpackConfigOptions.buildOptions;
    const projectConfig = webpackConfigOptions.projectConfig as ProjectConfig;
    const environment = buildOptions.environment || {};

    const srcDir = projectConfig.srcDir ? path.resolve(projectRoot, projectConfig.srcDir) : projectRoot;
    const entryPoints: { [key: string]: string[] } = {};
    const stylePlugins: any[] = [];

    // style-loader does not support sourcemaps without absolute publicPath, so it's
    // better to disable them when not extracting css
    // https://github.com/webpack-contrib/style-loader#recommended-configuration
    const cssSourceMap = (projectConfig as AppProjectConfig).extractCss && projectConfig.sourceMap;

    const minimizeCss = buildOptions.production;

    // Convert absolute resource URLs to account for base-href and deploy-url.
    const publicPath = (projectConfig as AppProjectConfig).publicPath || (buildOptions as any).publicPath || '';
    const baseHref = (projectConfig as AppProjectConfig).baseHref || (buildOptions as any).baseHref || '';
    const globalStylePaths: string[] = [];

    const includePaths: string[] = [];
    if (projectConfig.stylePreprocessorOptions &&
        projectConfig.stylePreprocessorOptions.includePaths &&
        projectConfig.stylePreprocessorOptions.includePaths.length > 0
    ) {
        projectConfig.stylePreprocessorOptions.includePaths.forEach((includePath: string) =>
            includePaths.push(path.resolve(srcDir, includePath)));
    }

    // set base rules to derive final rules from
    const baseRules: any[] = [
        { test: /\.css$/, use: [] },
        {
            test: /\.scss$|\.sass$/, use: [{
                loader: 'sass-loader',
                options: {
                    sourceMap: cssSourceMap,
                    // bootstrap-sass requires a minimum precision of 8
                    precision: 8,
                    includePaths
                }
            }]
        },
        {
            test: /\.less$/, use: [{
                loader: 'less-loader',
                options: {
                    sourceMap: cssSourceMap
                }
            }]
        }
    ];

    // ReSharper disable once Lambda
    const postcssPluginFactory = function (): any[] {
        // safe settings based on: https://github.com/ben-eb/cssnano/issues/358#issuecomment-283696193
        const importantCommentRe = /@preserve|@license|[@#]\s*source(?:Mapping)?URL|^!/i;
        const minimizeOptions = {
            autoprefixer: false, // full pass with autoprefixer is run separately
            safe: true,
            mergeLonghand: false, // version 3+ should be safe; cssnano currently uses 2.x
            discardComments: { remove: (comment: string) => !importantCommentRe.test(comment) }
        };

        return [
            postcssUrl({
                url: (u: string) => {
                    // Only convert root relative URLs, which CSS-Loader won't process into require().
                    if (!u.startsWith('/') || u.startsWith('//')) {
                        return u;
                    }

                    if (publicPath.match(/:\/\//)) {
                        // If deployUrl contains a scheme, ignore baseHref use deployUrl as is.
                        return `${publicPath.replace(/\/$/, '')}${u}`;
                    } else if (baseHref.match(/:\/\//)) {
                        // If baseHref contains a scheme, include it as is.
                        return baseHref.replace(/\/$/, '') +
                            `/${publicPath}/${u}`.replace(/\/\/+/g, '/');
                    } else {
                        // Join together base-href, deploy-url and the original URL.
                        // Also dedupe multiple slashes into single ones.
                        return `/${baseHref}/${publicPath}/${u}`.replace(/\/\/+/g, '/');
                    }
                }
            }),
            autoprefixer()
        ].concat(
            minimizeCss ? [cssnano(minimizeOptions)] : []
            );
    };

    const commonLoaders: any[] = [
        {
            loader: 'css-loader',
            options: {
                sourceMap: cssSourceMap,
                importLoaders: 1
            }
        },
        {
            loader: 'postcss-loader',
            options: {
                // non-function property is required to workaround a webpack option handling bug
                ident: 'postcss',
                plugins: postcssPluginFactory
            }
        }
    ];

    // process global styles
    let globalStyleParsedEntries: StyleParsedEntry[] = [];
    if (projectConfig.styles && projectConfig.styles.length > 0) {
        globalStyleParsedEntries = parseStyleEntry(projectConfig.styles, srcDir, 'styles');
        globalStylePaths.push(...globalStyleParsedEntries.map((style) => style.path));
    }


    const styleRules: any[] = baseRules.map(({ test, use }) => ({
        exclude: globalStylePaths,
        test,
        use: [
            'exports-loader?module.exports.toString()' // or raw-loader?
        ].concat(commonLoaders).concat(use)
    }));

    // app only
    if (projectConfig.projectType === 'app' &&
        projectConfig.platformTarget === 'web' &&
        !environment.dll && !environment.test) {
        // determine hashing format
        const hashFormat = (projectConfig as AppProjectConfig).appendOutputHash ? `.[contenthash:${20}]` : '';

        // load global css as css files
        if (globalStyleParsedEntries.length > 0) {

            // add style entry points
            globalStyleParsedEntries.forEach(style =>
                entryPoints[style.entry]
                    ? entryPoints[style.entry].push(style.path)
                    : entryPoints[style.entry] = [style.path]
            );


            styleRules.push(...baseRules.map(({ test, use }) => {
                const extractTextPlugin = {
                    use: [
                        ...commonLoaders,
                        ...(use as any[])
                    ],
                    // publicPath needed as a workaround https://github.com/angular/angular-cli/issues/4035
                    publicPath: ''
                };
                const ret: any = {
                    include: globalStylePaths,
                    test,
                    use: (projectConfig as AppProjectConfig).extractCss
                        ? ExtractTextPlugin.extract(extractTextPlugin)
                        : ['style-loader', ...extractTextPlugin.use]
                };

                return ret;
            }));
        }

        // suppress empty .js files in css only entry points
        if ((projectConfig as AppProjectConfig).extractCss) {
            // extract global css from js files into own css file
            stylePlugins.push(
                new ExtractTextPlugin({
                    filename: `[name]${hashFormat}.css`
                }));
            stylePlugins.push(new SuppressEntryChunksWebpackPlugin({
                chunks: Object.keys(entryPoints),
                supressPattern: /\.js(\.map)?$/,
                assetTagsFilterFunc: (tag: any) => !(tag.tagName === 'script' &&
                    tag.attributes.src &&
                    tag.attributes.src.match(/\.css$/i))

            }));
        }
    }

    return {
        entry: entryPoints,
        module: { rules: styleRules },
        plugins: stylePlugins
    };
}
