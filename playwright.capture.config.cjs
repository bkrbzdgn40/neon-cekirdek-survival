const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({
 testDir:'./tests',
 testMatch:'**/*.capture.spec.cjs',
 timeout:30_000,
 expect:{timeout:10_000},
 retries:0,
 workers:1,
 reporter:'list',
 use:{
  baseURL:'http://127.0.0.1:8765',
  screenshot:'only-on-failure',
  trace:'retain-on-failure'
 },
 projects:[{name:'press-chromium',use:{
  ...devices['Desktop Chrome'],
  viewport:{width:1440,height:900},deviceScaleFactor:1
 }}],
 webServer:{
  command:'python3 -m http.server 8765 --bind 127.0.0.1',
  url:'http://127.0.0.1:8765/index.html',
  reuseExistingServer:!process.env.CI,
  timeout:30_000
 }
});
