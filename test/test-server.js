const express = require("express");
const { ApolloServer } = require('apollo-server-express');
const { schema } = require("../src/schema");
const voyager = require('graphql-voyager/middleware');
const { ensureDatabase } = require('../src/');


(async () => {
    console.log("checking database")
    try {
        await ensureDatabase(schema)
        console.log("database checked")
    } catch (e) {
        console.log(e)
    }
})();

const server = new ApolloServer({
    schema,
    formatError: error => {
        console.log("= error    =============================================");
        console.log(error);
        return error;
    },
    formatResponse: response => {
        console.log("= response =============================================");
        console.log(response);
        return response;
    },
});

const app = express();

app.use('/voyager', voyager.express({ endpointUrl: server.graphqlPath }));

server.applyMiddleware({ app });

app.listen({ port: 4000 }, () =>
  console.log(`🚀 Server ready at http://localhost:4000${server.graphqlPath}`)
)
