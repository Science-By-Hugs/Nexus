const sharp=require(process.env.NEXUS_SHARP_MODULE || 'sharp');
const fs=require('fs');
const tokens=JSON.parse(fs.readFileSync('brand/tokens/brand.tokens.json'));
const color=name=>{const t=tokens.color[name];if(t.$extensions.nexus.status!=='approved')throw Error('Unapproved color');return t.$value};
(async()=>{
const svg=fs.readFileSync('brand/assets/approved/n-dot.svg');
await sharp(svg).resize(1024,1024).flatten({background:color('surface')}).png().toFile('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
await sharp(svg).resize(180,180).png().toFile('public/brand/nexus-touch-icon.png');
const mark=await sharp(svg).resize(512,512).png().toBuffer();
const splash=await sharp({create:{width:2732,height:2732,channels:3,background:color('background')}}).composite([{input:mark,gravity:'centre'}]).png().toBuffer();
for(const name of ['splash-2732x2732-2.png','splash-2732x2732-1.png','splash-2732x2732.png'])fs.writeFileSync('ios/App/App/Assets.xcassets/Splash.imageset/'+name,splash);
})();
