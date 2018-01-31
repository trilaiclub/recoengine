'use strict';
var querystring = require('querystring');
var solr = require('solr-client');
var request = require('request');

//Config
  var configJson = process.cwd() + '/' + "config.json";
  var configObj = require(configJson);

module.exports = function(Recoengine) {

    //Private
      var solrBucket = configObj.solrbucket;
      solrBucket.client.host = process.env.SOLR_BUCKET;

      Recoengine.sClient = solr.createClient(solrBucket.client);

      Recoengine.articles = [];

      Recoengine.sqActivitiesByUserID = function(squery, userID, cb) {

          var response = "";
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
                  obj = err;
                 }else{

                  response = obj;
                  console.log("Response:" + JSON.stringify(obj, undefined, 2));
                 }

                 cb(err, obj);
              });
      };

    //Reco clone

      Recoengine.clone = function(obj){

        return JSON.parse(JSON.stringify(obj));
      }

    //Create object from two set array

      Recoengine.createNamedList = function(array, ru){

          var result = {};
          var key = '';
          for(var index = 0; index < array.length; index += 2){

              key = (ru) ? array[index].replace(/_/g, ' ') : array[index];
              result[key] = array[index+1]
          }

          return result;
      }

    //Build URL

      Recoengine.buildRequest = function(fCategory, query, fields) {

          var streamId = configObj.proxy.client.categoryStream + fCategory;
          var url = configObj.proxy.client.url
                              + '/feedlycoms/searchInFeedPipe'
                              + "?streamId=" + streamId
                              + "&query=" + query
                              + "&fields=" + fields;
          var options = {
                url: url.replace(/ /g, '%20')
          };

          return options;
      }

      //Parse body

      Recoengine.parseBody = function(body){

          var obj = JSON.parse(body);
          return JSON.parse(obj.response.body);
      }

    //Copy Array to maintain order

      Recoengine.copyArray = function(sObj, dObj) {

          for (const [key, value] of Object.entries(dObj)) {

              if(key in sObj) dObj[key] = sObj[key];
          }

          return dObj;
      }

    //Find in rules

        Recoengine.formatRulesAsCategory = function(rules) {

                    var result = {}; result.high = {}; result.low = {};
                    var high = {};
                    var low = {};

                    for(var index = 0; index < rules.length; index++){

                        var category = rules[index].category;

                        if(category == 'All') {

                          if(!(category in high))
                            high[category] = [];

                          high[category].push(rules[index]);
                        } else {

                          if(!(category in low))
                            low[category] = [];

                          low[category].push(rules[index]);
                        }
                    }

                    result = Object.assign(high, low);
                    return result;
                }

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

    //Compute UIR

          Recoengine.computeUIRank = function(sqResponse, cb){

            //Inverse of chronological order maintained
            var ranks = {"category": {}, "tokens": {}, "searchkeys": {}};

            var rFacets = sqResponse.facet_counts.facet_fields;
            var response = sqResponse.response;

            var sFacets = rFacets.category.concat(rFacets.tokens);
            var facets = Recoengine.createNamedList(sFacets, true);

            console.log("Docs:" + JSON.stringify(response.docs, undefined, 2));

            var docs = response.docs;
            for(var index = 0; index < docs.length; index++){

              //Category
              var catName = docs[index].category.toLowerCase();

              ranks.category[catName] = (Object.keys(facets).includes(catName)) ? facets[catName] : 0;

              //Tokens
              for(var tIndex = 0; tIndex < docs[index].tokens.length; tIndex++){

                  var tokenKey = docs[index].tokens[tIndex].toLowerCase();
                  var value = (Object.keys(facets).includes(tokenKey)) ? facets[tokenKey] : 0;
                  ranks.tokens[tokenKey] = value;

                  tokenKey = catName + "~" + tokenKey;
                  ranks.searchkeys[tokenKey] = value;
               }
            }

            cb(null, ranks);
          };

    //Process rule

        Recoengine.process  = function(phrase, rule) {

            var query = rule.cacheWord.replace(/~/g, '');
            var space = (query.length > 0) ? ' ' : '';
                query += space + phrase;
            console.log(query + '---');
            var options = Recoengine.buildRequest(rule.feedlyPipeTag, query, "title");
            return options;
        }

    //Compute

        Recoengine.compute = function(userID, cb) {

          var config = Recoengine.clone(configObj);


          //Purchased algo

          var purchasedQuery = config.uir.compute_purchased.params;
          var action = "purchased";

          console.log("Given " + action + " Query: " + purchasedQuery); //debug

          Recoengine.sqActivitiesByUserID(purchasedQuery, userID, function(err, sqResponse){

            Recoengine.computeUIRank(sqResponse, function(err, uiRanks) {

              Recoengine.find({where: {action:action}}, function(err, rRules){

                  var ruleSet = Recoengine.formatRulesAsCategory(rRules);
                  var isAllAvailable = ("All" in ruleSet);

                  console.log(ruleSet); //debug

                  var counter = Object.keys(uiRanks.searchkeys).length;
                  for (const [key, value] of Object.entries(uiRanks.searchkeys)) {

                      --counter;
                      var keyPair = key.split('~');
                      var category = keyPair[0];
                      var phrase = category + ' ' + keyPair[1];

                      var headers = [];
                      if(isAllAvailable) headers.push('All');
                      if(ruleSet[category]) headers.push(category);
                      console.log(headers);

                      var hCounter = headers.length;
                      for(var h = 0; h < headers.length; h++) {

                          --hCounter;
                          var header = headers[h];

                          if(header in ruleSet) {
                              var rCounter = ruleSet[header].length;
                              for(var index = 0; index < ruleSet[header].length; index++) {
                                  console.log(header);
                                  var options = Recoengine.process(phrase, ruleSet[header][index]);
                                  console.log(options); //debug

                                  --rCounter;
                                  request(options, Recoengine.requestProxy(counter, hCounter, rCounter, cb));

                              }
                          }
                      }
                  }

              });

              //cb(null, uiRanks);
            });
          });

          //Browsed algo

        }

        Recoengine.remoteMethod('compute', {
              http: {path: '/compute', verb: 'get'},
              accepts: {arg: 'userid', type: 'string'},
              returns: {arg: 'response', type: 'object', 'http': {source: 'res'}}
        });

        Recoengine.requestProxy = function(counter, hCounter, rCounter, cb) {

            return function (error, response, body) {

                var pResponse = {};

                if(error)
                   pResponse = error;
                else
                   pResponse = Recoengine.parseBody(body);

                console.log(pResponse);
                 //mocked data to avoid exploidation of 250 limit in feedly
                 //var proxyJson = process.cwd() + '/' + "proxysample.json";
                 //var pResponse = require(proxyJson);

                 //console.log(pResponse);
                 var eContents = pResponse;
                 let iCounter = eContents.items.length;
                 if(iCounter > 0) {
                     for(var iIndex = 0; iIndex < eContents.items.length; iIndex++ ) {

                       --iCounter;
                       Recoengine.addArticle(eContents.items[iIndex]);

                       var status = (counter + hCounter + rCounter + iCounter);
                       console.log("---"+counter+"----"+hCounter+"---"+rCounter+"-----"+iCounter+"|" + status);

                       if(status == 0 ) cb(null, Recoengine.articles);
                     }
                 } else {

                       var status = (counter + hCounter + rCounter + iCounter);
                       console.log("---"+counter+"----"+hCounter+"---"+rCounter+"-----"+iCounter+"|" + status);

                       if(status == 0 ) cb(null, Recoengine.articles);
                 }

                   //cb(null, pResponse);
             }
        }


        Recoengine.addArticle = function(obj) {

                    var imgUrl = '';

                    if('thumbnail' in obj)
                        imgUrl = (obj.thumbnail.length > 0) ? obj.thumbnail[0].url : null;

                    var content = 'Nothing available';

                    if('summary' in obj)
                    if('content' in obj.summary)
                      content = obj.summary.content;

                    var result = {
                                     "id": obj.id,
                                     "title": obj.title,
                                     "description": content,
                                     "sourceurl": obj.canonicalUrl,
                                     "urltoimage": imgUrl
                                   };

                    console.log(result); //debug

                    Recoengine.articles.push(result);
                }
};
