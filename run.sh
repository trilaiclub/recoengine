#! /bin/sh

forever start --verbose --append --uid "recoengine" --watch --watchDirectory ./server server/server.js --spinSleepTime 1000ms
