const gqldate = require("graphql-iso-date");

const {BeehiveDirectives, BeehiveTypeDefs} = require("./types")
const pgsql = require("./pgsql")
const influx = require("./influx")

var graphS3

try {
    graphS3 = require("@wildflowerschools/graphql-s3-directive")
} catch(err) {
    console.log(err)
    // not a problem, unless you want to use the s3-directive
}


exports.BeehiveResolvers = {
    Datetime: gqldate.GraphQLDateTime,
}

if (graphS3) {
    exports.BeehiveResolvers = Object.assign(exports.BeehiveResolvers, graphS3.resolvers)
}



exports.BeehiveDirectives = BeehiveDirectives
exports.BeehiveTypeDefs = BeehiveTypeDefs

exports.ensureDatabase = async function(schema) {
    await pgsql.ensureDatabase(schema)
    await influx.configureClient(schema)
}

exports.hivePg = pgsql
