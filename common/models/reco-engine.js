'use strict';
var querystring = require('querystring');
var solr = require('solr-client');

//Config
  var configJson = process.cwd() + '/' + "config.json";
  var config = require(configJson);

module.exports = function(Recoengine) {

    //Private
      var solrBucket = config.solrbucket;
      solrBucket.client.host = process.env.SOLR_BUCKET;

      Recoengine.sClient = solr.createClient(solrBucket.client);

      Recoengine.sqActivitiesByUserID = function(squery, userID) {

          //create solr client
            var query =Recoengine.sClient.createQuery();

            // load query
            query.parameters = squery;

            for(var index = 0; index < squery.length; index++) {
              squery[index] = squery[index].replace(" ", "%20");
            }

            query.set('fq=userid:'+userID);

              console.log("Build Query:  " + query);

              Recoengine.sClient.search(query,function(err,obj){
                 if(err){
                  console.log(err);
                 }else{
                  console.log(JSON.stringify(obj, undefined, 2));
                 }
              });
      };

    //Train

        Recoengine.train = function(data, cb) {
          Recoengine.create(data, function (err, instance) {
              if(err)
                instance = err;
              cb(null, instance);
          });
        }

        Recoengine.remoteMethod('train', {
              http: {path: '/train', verb: 'post'},
              accepts: {arg: 'data', type: 'object', http: { source: 'body' }},
              returns: {arg: 'response', type: 'object', 'http': {source: 'res'}}
        });

    //Compute

        Recoengine.compute = function(userID, cb) {

          var purchasedQuery = config.uir.compute_purchased.params;
          console.log("Given Query: " + purchasedQuery);

          var response = Recoengine.sqActivitiesByUserID(purchasedQuery, userID)

          Recoengine.prepareUIRank()

          cb(null, userID)
        }

        Recoengine.remoteMethod('compute', {
              http: {path: '/compute', verb: 'get'},
              accepts: {arg: 'userid', type: 'string'},
              returns: {arg: 'response', type: 'object', 'http': {source: 'res'}}
        });


};
