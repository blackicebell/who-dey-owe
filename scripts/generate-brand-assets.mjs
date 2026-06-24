import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const iconDir = 'assets/icons';
await mkdir(iconDir, { recursive: true });

const jobs = [
  {
    input: 'assets/brand/who-dey-owe-mark.svg',
    output: `${iconDir}/app-icon-1024.png`,
    size: 1024
  },
  {
    input: 'assets/brand/who-dey-owe-adaptive-foreground.svg',
    output: `${iconDir}/adaptive-icon-foreground-1024.png`,
    size: 1024
  },
  {
    input: 'assets/brand/who-dey-owe-splash.svg',
    output: `${iconDir}/splash-icon-1024.png`,
    size: 1024
  },
  {
    input: 'assets/brand/who-dey-owe-mark.svg',
    output: `${iconDir}/favicon-48.png`,
    size: 48
  },
  {
    input: 'assets/brand/who-dey-owe-logo.svg',
    output: `${iconDir}/logo-wide-1800x520.png`,
    width: 1800,
    height: 520
  },
  {
    input: 'assets/brand/who-dey-owe-mark.svg',
    output: `${iconDir}/logo-512.png`,
    size: 512
  },
  {
    input: 'assets/brand/who-dey-owe-flat.svg',
    output: `${iconDir}/app-icon-flat-1024.png`,
    size: 1024
  },
  {
    input: 'assets/brand/who-dey-owe-dark.svg',
    output: `${iconDir}/app-icon-dark-1024.png`,
    size: 1024
  },
  {
    input: 'assets/brand/who-dey-owe-transparent-source.svg',
    output: `${iconDir}/transparent-source-1024.png`,
    size: 1024
  }
];

for (const job of jobs) {
  await sharp(job.input)
    .resize(job.size ?? job.width, job.size ?? job.height)
    .png()
    .toFile(job.output);
}

console.log(`Generated ${jobs.length} brand assets.`);
