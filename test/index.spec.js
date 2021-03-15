const run = require('docker-run')
const { request } = require('graphql-request')
const expect = require('chai').expect
const { Pool } = require('pg')
const pool = new Pool()
const { server } = require("./testsupport")
const { queryType } = require("../src/hive/pgsql")
const { schema } = require("../src/schema")


const uri = "http://localhost:4423/graphql"

process.env.ENVIRONMENT = "local"
process.env.PGPASSWORD = "iamaninsecurepassword"
process.env.PGUSER = "beehive_user"
process.env.PGDATABASE = "beehive-tests-integrated"
process.env.PGHOST = "localhost"
process.env.PGPORT = "5432"

var dbContainer
var influxContainer

if (process.env.BEEHIVE_MOCK_STREAM == "yes") {
    var kinesalite = require('kinesalite'),
    kinesaliteServer = kinesalite()
    kinesaliteServer.listen(4567, function(err) {
        if (err) throw err
        console.log('Kinesalite started on port 4567')
    })
    const AWS = require('aws-sdk');
    kinesis_mock = new AWS.Kinesis({endpoint: "http://localhost:4567"});
    kinesis_mock.createStream({StreamName: "beehive_stream", ShardCount: 1}, console.log)
}


before(async function() {
    // helper for waiting for things
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // check for postgreSQL to be running
    function status() {
        return pool.query("SELECT 'hello world'").then(data => {
          return true
        }).catch(err => {
          return false})
    }

    console.log('starting influxdb')
    influxContainer = run('influxdb:1.5-alpine', {
      remove: true,
      ports: {
        8086: 8086
      }
    })

    // do the deed, get postgreSQL running
    dbContainer = await (async function() {
        console.log('starting postgres')
        var isUp = await status()
        if (isUp) {
            console.log('postgres is already up')
            return true
        }
        var child = run('postgres:10.4', {
          remove: true,
          env: {
              POSTGRES_PASSWORD: "iamaninsecurepassword",
              POSTGRES_USER: "beehive_user",
              POSTGRES_DB: "beehive-tests-integrated",
          },
          ports: {
            5432: 5432
          }
        })
        // wait for it to come up
        for (let i=0; i < 4; i++) {
            var ok = await status()
            if (ok) {
                await sleep(10000)
                console.log("returning child")
                return child
            }
            await sleep(3000)
        }

        // if it hasn't come up destroy it
        child.destroy()
        throw Error("postgres didn't start")
    })()
    return
})


after(async function(){
    console.log("shutting down postgres and express")
    dbContainer.destroy()
    console.log("shutting down influxdb")
    influxContainer.destroy()
})


describe('Beehive general suite', function() {
    var expressApp

    before(async function() {
        // setup an apollo-server-express app and run it
        expressApp = await server(schema)
    })

    after(async function() {
        expressApp.close()
    })

    describe('delete', function() {

        before(async function() {
            process.env.DEBUG = "yes"
        })

        after(async function() {
            process.env.DEBUG = "no"
        })

        it('make a thing and delete it', async function() {
            const createQuery = `
                    mutation {
                      newThing(thing: {name: "testThingToDelete"}) {
                        thing_id
                      }
                    }
                `
            var thing = await request(uri, createQuery)
            expect(thing).to.not.equal(null)
            expect(thing.newThing.thing_id).to.not.equal(null)
            var deleteQuery = `
                mutation {
                    deleteThing(thing_id: "${thing.newThing.thing_id}") {
                        status
                        error
                    }
                }
            `
            var deleteResponse = await request(uri, deleteQuery)
            console.log(deleteResponse)
            expect(deleteResponse).to.not.equal(null)
            expect(deleteResponse.deleteThing.status).to.not.equal(null)
            expect(deleteResponse.deleteThing.status).to.equal("ok")
        })
    })

    describe('delete cascading', function() {

        it('make a thing and delete it', async function() {
            const createQuery = `
                    mutation {
                      newThing(thing: {name: "testThingToDelete"}) {
                        thing_id
                      }
                    }
                `
            var thing = await request(uri, createQuery)
            expect(thing).to.not.equal(null)
            expect(thing.newThing.thing_id).to.not.equal(null)

            var relatedQuery = `
                mutation {
                  newRelatedThing(relatedThing: {name: "relatedThingToDelete", subject: "delete", thing: "${thing.newThing.thing_id}"}) {
                        rel_thing_id
                    }
                }
            `
            var relResponse = await request(uri, relatedQuery)
            expect(relResponse).to.not.equal(null)
            expect(relResponse.newRelatedThing.rel_thing_id).to.not.equal(null)

            var deleteQuery = `
                mutation {
                    deleteThingCascading(thing_id: "${thing.newThing.thing_id}") {
                        status
                        error
                    }
                }
            `
            var deleteResponse = await request(uri, deleteQuery)
            expect(deleteResponse).to.not.equal(null)
            expect(deleteResponse.deleteThingCascading.status).to.not.equal(null)
            expect(deleteResponse.deleteThingCascading.status).to.equal("ok")

            var getQuery = `
                query {
                    getRelatedThing(rel_thing_id: "${relResponse.newRelatedThing.rel_thing_id}") {
                        rel_thing_id
                    }
                }
            `
            var getResponse = await request(uri, getQuery)
            expect(getQuery.getRelatedThing).to.equal(undefined)
        })
    })

    describe('things', function() {

        it('assignments', async function() {
            const query = `
                    mutation {
                      holder1: holder(holder: {name: "holder1"}) {
                            holder_id
                        }
                      holder2: holder(holder: {name: "holder2"}) {
                            holder_id
                        }
                      held1: held(held: {name: "highlander1"}) {
                            held_id
                      }
                      held2: held(held: {name: "highlander2"}) {
                            held_id
                      }
                    }
                `
            var results = await request(uri, query)
            expect(results.held1.held_id).to.not.equal(null)
            expect(results.held2.held_id).to.not.equal(null)
            expect(results.holder1.holder_id).to.not.equal(null)
            expect(results.holder2.holder_id).to.not.equal(null)
            var assign_1 = `
                    mutation {
                        assignment1: assignment(assignment: {assigned: "${results.held1.held_id}", holder: "${results.holder1.holder_id}", start: "${new Date().toISOString()}"}) {
                            assignment_id
                        }
                        assignment2: assignment(assignment: {assigned: "${results.held2.held_id}", holder: "${results.holder1.holder_id}", start: "${new Date().toISOString()}"}) {
                            assignment_id
                        }
                    }
                `
            var results_assign_1 = await request(uri, assign_1)
            console.log("================== ASSIGNMENTS ==============================")
            console.log(results_assign_1)
            expect(results_assign_1.assignment1.assignment_id).to.not.equal(null)
            expect(results_assign_1.assignment2.assignment_id).to.not.equal(null)
            var verifyQuery = `
                query {
                  getAssignments {
                    data {
                      assignment_id
                      assigned {
                        ... on Held {
                            held_id
                        }
                      }
                      holder {
                        holder_id
                      }
                      start
                      end
                    }
                  }
                }
            `
            console.log("================== VERIFICATION SET 1 =======================")
            var verificationSet = await request(uri, verifyQuery)
            console.log(verificationSet)
            expect(verificationSet.getAssignments.data.length).to.equal(2)
            var assign_2 = `
                    mutation {
                        assignment1: assignment(assignment: {assigned: "${results.held1.held_id}", holder: "${results.holder2.holder_id}", start: "${new Date().toISOString()}"}) {
                            assignment_id
                        }
                    }
                `
            var results_assign_2 = await request(uri, assign_2)
            console.log("================== VERIFICATION SET 2 =======================")
            verificationSet = await request(uri, verifyQuery)
            console.log(verificationSet)
            expect(verificationSet.getAssignments.data.length).to.equal(3)
            for(var assignment of verificationSet.getAssignments.data) {
                if(assignment.assignment_id == results_assign_2.assignment1.assignment_id) {
                    expect(assignment.end).to.equal(null)
                    expect(assignment.assigned.held_id).to.equal(results.held1.held_id)
                    expect(assignment.holder.holder_id).to.equal(results.holder2.holder_id)
                } else if(assignment.assigned.held_id == results.held1.held_id) {
                    expect(assignment.end).to.not.equal(null)
                    expect(assignment.assigned.held_id).to.equal(results.held1.held_id)
                    expect(assignment.holder.holder_id).to.equal(results.holder1.holder_id)
                } else if(assignment.assigned.held_id == results.held1.held_id) {
                    expect(assignment.end).to.equal(null)
                    expect(assignment.assigned.held_id).to.equal(results.held2.held_id)
                    expect(assignment.holder.holder_id).to.equal(results.holder1.holder_id)
                }
            }

            // test filtering on an assignment
            var filer_assignments_1 = `
                query {
                    getHolder(holder_id: "${results.holder1.holder_id}") {
                        holder_id
                        assignments(current: true) {
                            assignment_id
                        }
                    }
                }
            `
            var results_filer_assignments_1 = await request(uri, filer_assignments_1)
            console.log("-------------------------------------------------------")
            console.log("-------------------------------------------------------")
            console.log(results_filer_assignments_1.getHolder.assignments)
            console.log("-------------------------------------------------------")
            console.log("-------------------------------------------------------")
            expect(results_filer_assignments_1.getHolder.assignments.length).to.equal(1)
            expect(results_filer_assignments_1.getHolder.assignments[0].assignment_id).to.equal(results_assign_1.assignment2.assignment_id)
        })

        it('creates a thing', async function() {
            var query = `
                    mutation {
                      newThing(thing: {name: "thing"}) {
                        thing_id
                        name
                        system {
                            created
                        }
                      }
                    }
                `
            var thing = await request(uri, query)
            // console.log(thing)
            expect(thing).to.not.equal(null)
            expect(thing.newThing.thing_id).to.not.equal(null)
            expect(thing.newThing.name).to.equal("thing")
            expect(thing.newThing.system.created).to.not.equal(null)
        })

        it('replaces a thing', async function() {
            var query = `
                    mutation {
                      newThing(thing: {name: "tobereplaced"}) {
                        thing_id
                        name
                        system {
                            created
                        }
                      }
                    }
                `
            var thing = await request(uri, query)
            expect(thing.newThing.name).to.equal("tobereplaced")
            query = `
                    mutation {
                        replaceThing(thing_id: "${thing.newThing.thing_id}", thing: {name: "replaced"}) {
                            thing_id
                            name
                            system {
                                created
                                last_modified
                            }
                        }
                    }
                `
            var replacedthing = await request(uri, query)
            expect(replacedthing.replaceThing.name).to.equal("replaced")
            expect(replacedthing.replaceThing.thing_id).to.equal(thing.newThing.thing_id)
        })

        it('patch a related thing', async function() {
            var query = `
                    mutation {
                      newRelatedThing(relatedThing: {name: "munster", subject: "director"}) {
                            rel_thing_id
                            name
                            subject
                        }
                    }
                `
            var thing = await request(uri, query)
            expect(thing.newRelatedThing.name).to.equal("munster")
            expect(thing.newRelatedThing.subject).to.equal("director")
            query = `
                    mutation {
                        updateRelatedThing(rel_thing_id: "${thing.newRelatedThing.rel_thing_id}", relatedThing: {subject: "futurama"}) {
                            rel_thing_id
                            name
                            subject
                        }
                    }
                `
            thing = await request(uri, query)
            expect(thing.updateRelatedThing.name).to.equal("munster")
            expect(thing.updateRelatedThing.subject).to.equal("futurama")
        })

        it('list things', async function() {
            // this can fail if the delete things fail
            var query = `
                    query {
                      things {
                        data {
                            ... on Thing {
                                thing_id
                                name
                            }
                        }
                      }
                    }
                `
            var things = await request(uri, query)
            // console.log(things)
            expect(things).to.not.equal(null)
            expect(things.things.data).to.not.equal(null)
            expect(things.things.data[0].thing_id).to.not.equal(null)
            expect(things.things.data[0].name).to.equal("thing")
        })

        it('create a related thing', async function() {
            var query = `
                    mutation {
                      newThing(thing: {name: "thing"}) {
                        thing_id
                      }
                    }
                `
            var thing = await request(uri, query)
            query = `
                    mutation {
                      newRelatedThing(relatedThing: {name: "thing", subject: "director", thing: "${thing.newThing.thing_id}"}) {
                            rel_thing_id
                            name
                            subject
                            thing {
                                thing_id
                            }
                            start
                        }
                    }
                `
            // console.log(query)
            var rel_thing = await request(uri, query)
            // console.log(rel_thing)
            expect(rel_thing).to.not.equal(null)
            expect(rel_thing.newRelatedThing.rel_thing_id).to.not.equal(null)
            expect(rel_thing.newRelatedThing.name).to.equal("thing")
            expect(rel_thing.newRelatedThing.subject).to.equal("director")
            expect(rel_thing.newRelatedThing.thing.thing_id).to.equal(thing.newThing.thing_id)
        })

        it('get a thing', async function() {
            var query = `
                    mutation {
                        newThing(thing: {name: "monster-rock"}) {
                            thing_id
                        }
                    }
                `
            var thing = await request(uri, query)
            query = `
                    query {
                        getThing(thing_id: "${thing.newThing.thing_id}") {
                            thing_id
                            name
                        }
                    }
                `
            // console.log(query)
            var getThing = await request(uri, query)
            // console.log(getThing)
            expect(getThing.getThing).to.not.equal(null)
            expect(getThing.getThing.thing_id).to.equal(thing.newThing.thing_id)
            expect(getThing.getThing.name).to.equal("monster-rock")
        })


        it('findThings', async function() {
            var query = `
                    mutation {
                        first: newThing(thing: {name: "granola-bar"}) {
                            thing_id
                        }

                        second: newThing(thing: {name: "granola-bars"}) {
                            thing_id
                        }
                    }
                `
            var things = await request(uri, query)
            query = `
                    query {
                        findThings(query: {field: "name", operator: EQ, value: "granola-bars"}) {
                            data {
                                ... on Thing {
                                    thing_id
                                    name
                                }
                            }
                        }
                    }
                `
            var things = await request(uri, query)
            expect(things.findThings).to.not.equal(null)
            expect(things.findThings.data.length).to.equal(1)
            expect(things.findThings.data[0].thing_id).to.not.equal(null)
            expect(things.findThings.data[0].name).to.equal("granola-bars")
        })


        it('findThings with limit and sort', async function() {
            var query = `
                    mutation {
                        episode4: newThing(thing: {name: "Episode 4 - Star Wars: A New Hope"}) {
                            thing_id
                        }
                        episode5: newThing(thing: {name: "Episode 5 - Star Wars: The Empire Strikes Back"}) {
                            thing_id
                        }
                        episode6: newThing(thing: {name: "Episode 6 - Star Wars: Return of the Jedi"}) {
                            thing_id
                        }
                        episode1: newThing(thing: {name: "Episode 1 - Star Wars: The Phantom Menace"}) {
                            thing_id
                        }
                        episode2: newThing(thing: {name: "Episode 2 - Star Wars: Attack of the Clones"}) {
                            thing_id
                        }
                        episode3: newThing(thing: {name: "Episode 3 - Star Wars: Revenge of the Sith"}) {
                            thing_id
                        }
                        episode7: newThing(thing: {name: "Episode 7 - Star Wars: The Force Awakens"}) {
                            thing_id
                        }
                        episode8: newThing(thing: {name: "Episode 8 - Star Wars: The Last Jedi"}) {
                            thing_id
                        }
                    }
                `
            var things = await request(uri, query)
            query = `
                    query {
                        findThings(query: {field: "name", operator: LIKE, value: "%Star Wars%"}, page: {max: 2, sort: [{field: "name", direction: ASC}]}) {
                            data {
                                ... on Thing {
                                    thing_id
                                    name
                                }
                            }
                        }
                    }
                `
            things = await request(uri, query)
            console.log(things)
            expect(things.findThings).to.not.equal(null)
            expect(things.findThings.data.length).to.equal(2)
            expect(things.findThings.data[0].thing_id).to.not.equal(null)
            expect(things.findThings.data[0].name).to.equal("Episode 1 - Star Wars: The Phantom Menace")
            expect(things.findThings.data[1].thing_id).to.not.equal(null)
            expect(things.findThings.data[1].name).to.equal("Episode 2 - Star Wars: Attack of the Clones")
            query = `
                    query {
                        findThings(query: {field: "name", operator: LIKE, value: "%Star Wars%"}, page: {max: 1, sort: [{field: "name", direction: DESC}]}) {
                            data {
                                ... on Thing {
                                    thing_id
                                    name
                                }
                            }
                            page_info {
                                count
                                cursor
                            }
                        }
                    }
                `
            things = await request(uri, query)
            console.log(things)
            expect(things.findThings).to.not.equal(null)
            expect(things.findThings.data.length).to.equal(1)
            expect(things.findThings.page_info.count).to.equal(1)
            expect(things.findThings.data[0].thing_id).to.not.equal(null)
            expect(things.findThings.data[0].name).to.equal("Episode 8 - Star Wars: The Last Jedi")
            query = `
                    query {
                        findThings(query: {field: "name", operator: LIKE, value: "%Star Wars%"}, page: {cursor: "${things.findThings.page_info.cursor}", max: 1, sort: [{field: "name", direction: DESC}]}) {
                            data {
                                ... on Thing {
                                    thing_id
                                    name
                                }
                            }
                            page_info {
                                count
                                cursor
                            }
                        }
                    }
                `
            things = await request(uri, query)
            console.log(things)
            expect(things.findThings).to.not.equal(null)
            expect(things.findThings.data.length).to.equal(1)
            expect(things.findThings.page_info.count).to.equal(1)
            expect(things.findThings.data[0].thing_id).to.not.equal(null)
            expect(things.findThings.data[0].name).to.equal("Episode 7 - Star Wars: The Force Awakens")
        })

        it('matchThings', async function() {
            // matchThings(
            //     name: String,
            //     material: String,
            //     type: TypeOfThing,
            //     page: PaginationInput): ThingList @beehiveSimpleQuery(target_type_name: "Thing")
            var query = `
                    mutation {
                        first: newThing(thing: {name: "brownie-bar"}) {
                            thing_id
                        }

                        second: newThing(thing: {name: "brownie-bars"}) {
                            thing_id
                        }
                    }
                `
            var things = await request(uri, query)
            query = `
                    query {
                        matchThings(name: "brownie-bar") {
                            data {
                                ... on Thing {
                                    thing_id
                                    name
                                }
                            }
                        }
                    }
                `
            var things = await request(uri, query)
            expect(things.matchThings).to.not.equal(null)
            expect(things.matchThings.data.length).to.equal(1)
            expect(things.matchThings.data[0].thing_id).to.not.equal(null)
            expect(things.matchThings.data[0].name).to.equal("brownie-bar")
        })


        it('list relations', async function() {
            var query = `
                    mutation {
                      newThing(thing: {name: "multiple-related"}) {
                        thing_id
                      }
                    }
                `
            var thing = await request(uri, query)
            query = `
                    mutation {
                      first: newRelatedThing(relatedThing: {name: "related 1", thing: "${thing.newThing.thing_id}"}) {
                            rel_thing_id
                        }
                      second: newRelatedThing(relatedThing: {name: "related 2", thing: "${thing.newThing.thing_id}"}) {
                            rel_thing_id
                        }
                    }
                `
            // console.log(query)
            var related = await request(uri, query)
            // console.log(related)
            expect(related).to.not.equal(null)
            expect(related.first.rel_thing_id).to.not.equal(null)
            expect(related.second.rel_thing_id).to.not.equal(null)

            query = `
                    query {
                        updatedThing: getThing(thing_id: "${thing.newThing.thing_id}") {
                            related {
                                rel_thing_id
                            }
                        }
                    }
                `
            // console.log(query)
            var getThing = await request(uri, query)
            // console.log(getThing)
            expect(getThing.updatedThing.related).to.not.equal(null)
            expect(getThing.updatedThing.related.length).to.equal(2)
        })


        it('filtered timestamped relations', async function() {
            var query = `
                    mutation {
                      newThing(thing: {name: "observatory"}) {
                        thing_id
                      }
                    }
                `
            var thing = await request(uri, query)
            query = `
                    mutation {
                      observation1: observe(observation: {timestamp: "2019-01-01T10:10:10.000Z", thing: "${thing.newThing.thing_id}", data: "data 1"}) {
                        observation_id
                      }
                      observation2: observe(observation: {timestamp: "2019-01-02T10:10:10.000Z", thing: "${thing.newThing.thing_id}", data: "data 2"}) {
                        observation_id
                      }
                      observation3: observe(observation: {timestamp: "2019-01-03T10:10:10.000Z", thing: "${thing.newThing.thing_id}", data: "data 3"}) {
                        observation_id
                      }
                      observation4: observe(observation: {timestamp: "2019-01-04T10:10:10.000Z", thing: "${thing.newThing.thing_id}", data: "data 4"}) {
                        observation_id
                      }
                      observation5: observe(observation: {timestamp: "2019-01-05T10:10:10.000Z", thing: "${thing.newThing.thing_id}", data: "data 5"}) {
                        observation_id
                      }
                    }
                `
            // console.log(query)
            var related = await request(uri, query)
            console.log(related)

            query = `
                    query {
                        getThing(thing_id: "${thing.newThing.thing_id}") {
                            observations(since: "2019-01-03T10:08:10.000Z") {
                                observation_id
                                data
                            }
                        }
                    }
                `
            // console.log(query)
            var getThing = await request(uri, query)
            // console.log(getThing)
            expect(getThing.getThing.observations).to.not.equal(null)
            expect(getThing.getThing.observations.length).to.equal(3)

            query = `
                    query {
                        getThing(thing_id: "${thing.newThing.thing_id}") {
                            observations(before: "2019-01-03T10:08:10.000Z") {
                                observation_id
                                data
                            }
                        }
                    }
                `
            // console.log(query)
            var getThing = await request(uri, query)
            // console.log(getThing)
            expect(getThing.getThing.observations).to.not.equal(null)
            expect(getThing.getThing.observations.length).to.equal(2)

            query = `
                    query {
                        getThing(thing_id: "${thing.newThing.thing_id}") {
                            observations(since: "2019-01-03T10:08:10.000Z", before: "2019-01-03T10:20:10.000Z") {
                                observation_id
                                data
                            }
                        }
                    }
                `
            // console.log(query)
            var getThing = await request(uri, query)
            // console.log(getThing)
            expect(getThing.getThing.observations).to.not.equal(null)
            expect(getThing.getThing.observations.length).to.equal(1)
            expect(getThing.getThing.observations[0].data).to.equal("data 3")

        })


        it('nestedSearch', async function() {
            var query = `
                    mutation {
                        first: makeNest(nest: {occupant: {name: "duck", age: 2}}) {
                            nest_id
                        }

                        second: makeNest(nest: {occupant: {name: "grey duck", age: 2}}) {
                            nest_id
                        }
                    }
                `
            var things = await request(uri, query)
            query = `
                    query {
                        findNests(query: {field: "nest_id", operator: NE, value: ""}) {
                            data {
                                nest_id
                                occupant {
                                    name
                                }
                            }
                        }
                    }
                `
            var things = await request(uri, query)
            console.log(JSON.stringify(things))
            query = `
                    query {
                        findNests(query: {field: "occupant.name", operator: EQ, value: "grey duck"}) {
                            data {
                                nest_id
                            }
                        }
                    }
                `
            var things = await request(uri, query)
            expect(things.findNests).to.not.equal(null)
            expect(things.findNests.data.length).to.equal(1)
        })



        it('tagTeam', async function() {
            const createQuery = `
                    mutation {
                      thing1: newThing(thing: {name: "tagTeam1", material: "pencil-tape", tags: ["new", "blue"], timestamp: "2019-11-11T11:11:00.000Z", type: WOOD}) {
                        thing_id
                        tags
                      }

                      thing2: newThing(thing: {name: "tagTeam2", material: "pencil-tape", tags: ["new", "red"], dimensions: [0.1, 10.23]}) {
                        thing_id
                        tags
                      }

                      thing3: newThing(thing: {name: "tagTeam3", material: "pencil-tape"}) {
                        thing_id
                        tags
                      }

                      thing4: newThing(thing: {name: "tagTeam4", material: "pencil-tape"}) {
                        thing_id
                        tags
                      }

                    }
                `
            var thing = await request(uri, createQuery)
            console.log(thing)
            expect(thing).to.not.equal(null)
            expect(thing.thing1.tags).to.eql(["new", "blue"])
            expect(thing.thing3.tags).to.equal(null)
            let someThings = [
                thing.thing1.thing_id,
                thing.thing4.thing_id,
            ]
            const mutateQuery = `
                    mutation {
                      thing1: tagThing(thing_id: "${thing.thing1.thing_id}", tags: ["orange"]) {
                        thing_id
                        tags
                      }

                      thing2: untagThing(thing_id: "${thing.thing2.thing_id}", tags: ["red"]) {
                        thing_id
                        tags
                      }

                      thing3: tagThing(thing_id: "${thing.thing3.thing_id}", tags: ["red"]) {
                        thing_id
                        tags
                      }

                      thing4: untagThing(thing_id: "${thing.thing4.thing_id}", tags: "['red']") {
                        thing_id
                        tags
                      }

                    }
                `
            console.log(mutateQuery)
            var thing = await request(uri, mutateQuery)
            expect(thing).to.not.equal(null)
            expect(thing.thing1.tags).to.eql(["new", "blue", "orange"])
            expect(thing.thing2.tags).to.eql(["new"])
            expect(thing.thing3.tags).to.eql(["red"])
            expect(thing.thing4.tags).to.eql([])

            query = `
                    query {
                        findThings(query: {field: "material", operator: EQ, value: "pencil-tape"}) {
                            data {
                                ... on Thing {
                                    thing_id
                                    name
                                    tags
                                    dimensions
                                }
                            }
                        }
                    }
                `
            var things = await request(uri, query)
            console.log(things.findThings.data)
            expect(things.findThings).to.not.equal(null)
            expect(things.findThings.data.length).to.equal(4)


            query = `
                    query {
                        findThings(query: {field: "tags", operator: CONTAINS, values: ["new"]}) {
                            data {
                                ... on Thing {
                                    thing_id
                                    name
                                    tags
                                    dimensions
                                }
                            }
                        }
                    }
                `
            var things = await request(uri, query)
            console.log(things.findThings.data)
            expect(things.findThings).to.not.equal(null)
            expect(things.findThings.data.length).to.equal(2)

 

            query = `
                    query {
                        findThings(query: {field: "thing_id", operator: IN, values: ${JSON.stringify(someThings)}}) {
                            data {
                                ... on Thing {
                                    thing_id
                                }
                            }
                        }
                    }
                `
            var things = await request(uri, query)
            console.log(things.findThings.data)
            expect(things.findThings).to.not.equal(null)
            expect(things.findThings.data.length).to.equal(2)

            query = `
                    query {
                        findThings(query: {operator: AND, children: [
                                {field: "tags", operator: CONTAINED_BY, values: ["orange", "red"]},
                                {field: "tags", operator: NE, values: []}
                            ]}) {
                            data {
                                ... on Thing {
                                    thing_id
                                    tags
                                }
                            }
                        }
                    }
                `
            var things = await request(uri, query)

            console.log("CONTAINED_BY in a native column")
            console.log(things.findThings.data)
            expect(things.findThings).to.not.equal(null)
            expect(things.findThings.data.length).to.equal(1)



            query = `
                    query {
                        findThings(query: {field: "tags", operator: EQ, values: ["red"]}) { 
                            data {
                                ... on Thing {
                                    thing_id
                                    name
                                    tags
                                    dimensions
                                }
                            }
                        }
                    }
                `
            var things = await request(uri, query)
            console.log(things.findThings.data)
            expect(things.findThings).to.not.equal(null)
            expect(things.findThings.data.length).to.equal(1)
        })

        it('explain query for native', async function() {
            var table_config = schema._beehive.tables["Thing"]
            var query = {field: "material", operator: "EQ", value: "pencil-tape"}
            var explained = await queryType(schema, table_config, query, null, true)
            console.log("============= explanation ===============")
            console.log(explained)
            console.log("=========================================")
            expect(explained).to.not.equal(null)
            expect(explained.rows[0]['QUERY PLAN']).to.to.match(/^Index Scan/)
            expect(explained.rows[0]['QUERY PLAN']).to.to.match(/beehive_things__material_type/)
        })



        it('containment', async function() {
            const createQuery = `
                    mutation {
                      vortex_1: createVortex(vortex: {name: "interdimensional portal 1", tags: ["new", "blue"]}) {
                        vortex_id
                        tags
                      }

                      vortex_2: createVortex(vortex: {name: "interdimensional portal 2", tags: ["new", "true"]}) {
                        vortex_id
                        tags
                      }

                      vortex_3: createVortex(vortex: {name: "interdimensional portal 3", tags: ["new", "true"]}) {
                        vortex_id
                        tags
                      }

                      vortex_4: createVortex(vortex: {name: "interdimensional portal 4", tags: ["new", "angus", "marital"]}) {
                        vortex_id
                        tags
                      }

                      vortex_5: createVortex(vortex: {name: "interdimensional portal5 ", tags: ["new", "99"]}) {
                        vortex_id
                        tags
                      }

                      vortex_6: createVortex(vortex: {name: "interdimensional portal 6", tags: ["problems", "cop"]}) {
                        vortex_id
                        tags
                      }

                      vortex_7: createVortex(vortex: {name: "interdimensional portal 7", tags: ["blue"]}) {
                        vortex_id
                        tags
                      }

                      vortex_8: createVortex(vortex: {name: "interdimensional portal 8", tags: ["yellow"]}) {
                        vortex_id
                        tags
                      }
                    }
                `
            var vorts_created = await request(uri, createQuery)
            console.log(vorts_created)
            expect(vorts_created).to.not.equal(null)
            expect(vorts_created.vortex_1.tags).to.eql(["new", "blue"])

            query = `
                    query {
                        searchVortices(query: {field: "tags", operator: CONTAINS, values: ["new"]}) {
                            data {
                                vortex_id
                                tags
                            }
                        }
                    }
                `
            var vorts = await request(uri, query)
            console.log(vorts.searchVortices.data)
            expect(vorts.searchVortices).to.not.equal(null)
            expect(vorts.searchVortices.data.length).to.equal(5)

            query = `
                    query {
                        searchVortices(query: {field: "tags", operator: CONTAINS, values: ["yellow"]}) {
                            data {
                                vortex_id
                                tags
                            }
                        }
                    }
                `
            var vorts = await request(uri, query)
            console.log(vorts.searchVortices.data)
            expect(vorts.searchVortices).to.not.equal(null)
            expect(vorts.searchVortices.data.length).to.equal(1)

            const createCollectionsQuery = `
                    mutation {
                      collection_1: createCollection(collection: {items: ["${vorts_created.vortex_1.vortex_id}", "${vorts_created.vortex_2.vortex_id}"]}) {
                        collection_id
                      }

                      collection_2: createCollection(collection: {items: ["${vorts_created.vortex_1.vortex_id}", "${vorts_created.vortex_3.vortex_id}"]}) {
                        collection_id
                      }

                      collection_3: createCollection(collection: {items: ["${vorts_created.vortex_1.vortex_id}", "${vorts_created.vortex_4.vortex_id}"]}) {
                        collection_id
                      }

                      collection_4: createCollection(collection: {items: ["${vorts_created.vortex_1.vortex_id}", "${vorts_created.vortex_5.vortex_id}"]}) {
                        collection_id
                      }

                      collection_5: createCollection(collection: {items: ["${vorts_created.vortex_1.vortex_id}", "${vorts_created.vortex_6.vortex_id}"]}) {
                        collection_id
                      }

                      collection_6: createCollection(collection: {items: ["${vorts_created.vortex_1.vortex_id}", "${vorts_created.vortex_7.vortex_id}"]}) {
                        collection_id
                      }

                      collection_7: createCollection(collection: {items: ["${vorts_created.vortex_1.vortex_id}", "${vorts_created.vortex_8.vortex_id}"]}) {
                        collection_id
                      }

                      collection_8: createCollection(collection: {items: ["${vorts_created.vortex_6.vortex_id}", "${vorts_created.vortex_8.vortex_id}"]}) {
                        collection_id
                      }
                    }
                `
            var collections = await request(uri, createCollectionsQuery)
            console.log(collections)
            expect(collections).to.not.equal(null)
            let collection_ids = [
                collections.collection_1.collection_id,
                collections.collection_6.collection_id,
                collections.collection_7.collection_id,
            ]

            query = `
                    query {
                        searchCollections(query: {field: "items", operator: CONTAINS, values: ["${vorts_created.vortex_1.vortex_id}"]}) {
                            data {
                                collection_id
                                items {
                                    ... on Vortex {
                                        vortex_id
                                    }
                                }
                            }
                        }
                    }
                `
            var collections = await request(uri, query)
            console.log(collections)
            expect(collections.searchCollections).to.not.equal(null)
            expect(collections.searchCollections.data.length).to.equal(7)

            query = `
                    query {
                        searchCollections(query: {field: "items", operator: CONTAINS, values: ["${vorts_created.vortex_8.vortex_id}"]}) {
                            data {
                                collection_id
                                items {
                                    ... on Vortex {
                                        vortex_id
                                    }
                                }
                            }
                        }
                    }
                `
            var collections = await request(uri, query)
            console.log(collections.searchCollections.data)
            expect(collections.searchCollections).to.not.equal(null)
            expect(collections.searchCollections.data.length).to.equal(2)

            

            query = `
                    query {
                        searchCollections(query: {field: "collection_id", operator: IN, values: ${JSON.stringify(collection_ids)}}) {
                            data {
                                collection_id
                            }
                        }
                    }
                `
            var collections = await request(uri, query)
            console.log(collections.searchCollections.data)
            expect(collections.searchCollections).to.not.equal(null)
            expect(collections.searchCollections.data.length).to.equal(3)

            

            query = `
                    query {
                        searchCollections(query: {field: "items", operator: CONTAINED_BY, values: ["${vorts_created.vortex_1.vortex_id}", "${vorts_created.vortex_2.vortex_id}", "${vorts_created.vortex_3.vortex_id}"]}) {
                            data {
                                collection_id
                                items {
                                    ... on Vortex {
                                        vortex_id
                                    }
                                }
                            }
                        }
                    }
                `
            var collections = await request(uri, query)
            console.log(collections.searchCollections.data)
            expect(collections.searchCollections).to.not.equal(null)
            expect(collections.searchCollections.data.length).to.equal(2)

         })


    })
})


describe('Beehive no schema test', function(){

    describe('exceptions', function() {
        it('should fail', async function() {

            expect(function() { require("../src/schema/no_schema")}).to.throw(TypeError)
        })
    })
})
