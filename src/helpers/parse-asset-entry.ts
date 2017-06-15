﻿import * as fs from 'fs-extra';
import * as path from 'path';

import { AssetEntry } from '../models';

export type AssetParsedEntry = {
    from: {
        glob: string;
        dot?: boolean;
    } | string;
    context?: string;
    to?: string;
};

export function parseAssetEntry(baseDir: string, assetEntries: string | (string | AssetEntry)[]): AssetParsedEntry[] {
    if (!assetEntries || !assetEntries.length) {
        return [] as any;
    }

    const entries = Array.isArray(assetEntries) ? assetEntries : [assetEntries];
    const clonedEntries = entries.map((entry: any) =>
        typeof entry === 'object' ? Object.assign({ from: null }, entry) : entry
    );

    const prepareGlobFn = (p: string) => {
        if (!p) {
            return '';
        }

        if (p.lastIndexOf('*') === -1 &&
            !path.isAbsolute(p) &&
            fs.existsSync(path.resolve(baseDir, p)) &&
            fs.statSync(path.resolve(baseDir, p)).isDirectory()) {
            if (p.lastIndexOf('/') > -1) {
                p = p.substr(0, p.length - 1);
            }
            p += '/**/*';
        }
        return p;
    };

    return clonedEntries.map((asset: string | AssetEntry) => {
        if (typeof asset === 'string') {
            const fromGlob: string = prepareGlobFn(asset);
            if (fromGlob === asset && path.isAbsolute(fromGlob)) {
                return {
                    from: asset,
                    context: baseDir
                };
            }

            return {
                from: {
                    glob: fromGlob,
                    dot: true
                },
                context: baseDir
            };
        } else if (typeof asset === 'object' && (asset as AssetEntry).from) {
            const assetParsedEntry: AssetParsedEntry = Object.assign({}, asset);
            if (!assetParsedEntry.context) {
                assetParsedEntry.context = baseDir;
            }
            const from = (asset as AssetEntry).from;
            if (typeof from === 'string') {
                const fromGlob = prepareGlobFn(from);

                if (fromGlob === from && path.isAbsolute(fromGlob)) {
                    assetParsedEntry.from = from;
                } else {
                    assetParsedEntry.from = {
                        glob: fromGlob,
                        dot: true
                    };
                }
            }
            return assetParsedEntry;
        } else {
            throw new Error(`Invalid 'assets' value in appConfig.`);
        }
    });
}
