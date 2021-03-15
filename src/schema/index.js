const {
  makeExecutableSchema,
  mergeSchemas,
} = require('graphql-tools');
const {BeehiveDirectives, BeehiveTypeDefs} = require("../hive")



const logger = { log: e => console.log(e) }


exports.schema = makeExecutableSchema({
  typeDefs: [
    BeehiveTypeDefs,
`

    enum TypeOfThing {
        WOOD
        PLASTIC
        STONE
        WATER
    }

    interface AnyThing @beehiveTable(table_name: "things", pk_column: "thing_id") {
        thing_id: ID!
    }

    type Thing implements AnyThing @beehiveTable(
                table_name: "things",
                pk_column: "thing_id",
                table_type: native,
                partition: "name",
                native_indexes: [
                    {name: "material_type", type: btree, columns: ["material", "type"]},
                    {name: "tag", type: hash, columns: ["tags"]}
                ],
                native_exclude: ["dimensions"]
    ) {
        thing_id: ID!
        name: String
        material: String
        type: TypeOfThing
        related: [RelatedThing!] @beehiveRelationFilter(target_type_name: "RelatedThing", target_field_name: "thing")
        dimensions: [Float!]
        timestamp: Datetime
        observations: [Observation!] @beehiveRelationTimeFilter(target_type_name: "Observation", target_field_name: "thing", timestamp_field_name: "timestamp")
        tags: [String!]
    }

    input ThingInput {
        name: String
        dimensions: [Float!]
        material: String
        type: TypeOfThing
        tags: [String!]
        timestamp: Datetime
    }

    type RelatedThing @beehiveTable(table_name: "rel_things") {
        rel_thing_id: ID!
        name: String @beehiveIndexed(target_type_name: "Thing")
        thing: Thing @beehiveRelation(target_type_name: "Thing")
        subject: String
        start: Datetime
    }

    input RelatedThingInput {
        name: String
        thing: ID
        subject: String
        start: Datetime
    }

    type ThingList {
        data: [AnyThing!]!
        page_info: PageInfo!
    }

    type RelatedThingsList {
        data: [RelatedThing!]!
        page_info: PageInfo
    }

    type Observation @beehiveTable(table_name: "observations") {
        observation_id: ID!
        thing: Thing!
        timestamp: Datetime!
        data: String
    }

    input ObservationInput {
        timestamp: Datetime!
        thing: ID!
        data: String
    }

    type Holder @beehiveTable(table_name: "holders") {
        holder_id: ID!
        name: String
        assignments: [Assignment!] @beehiveAssignmentFilter(target_type_name: "Assignment", assignee_field: "holder")
    }

    type Held @beehiveTable(table_name: "held") {
        held_id: ID!
        name: String
    }

    union Assigned @beehiveUnion = Held | Thing

    type Assignment @beehiveAssignmentType(table_name: "assignments", assigned_field: "assigned", assignee_field: "holder", exclusive: true) {
        assignment_id: ID!
        assigned: Assigned! @beehiveUnionResolver(target_types: ["Held", "Thing"])
        holder: Holder! @beehiveRelation(target_type_name: "Holder")
        start: Datetime!
        end: Datetime
    }

    type AssignmentList {
        data: [Assignment!]!
        page_info: PageInfo!
    }

    type NestList {
        data: [Nest!]
        page_info: PageInfo!
    }

    type Nest @beehiveTable(table_name: "nests") {
        nest_id: ID!
        occupant: Occupant!
    }

    type Occupant {
        name: String
        age: Int
    }

    type MeasureOnce @beehiveTimeseriesCollection(measurement_name: "measure_once") {
        at: Datetime! @beehiveMeasurement(measurement_name: "measure_once", type: Timestamp)
        nest: Nest @beehiveMeasurement(measurement_name: "measure_once", type: Tag)
        diameter: Int @beehiveMeasurement(measurement_name: "measure_once", type: Measurement)
        radiance: Float @beehiveMeasurement(measurement_name: "measure_once", type: Measurement)
        chi: Int @beehiveMeasurement(measurement_name: "measure_once", type: Measurement)
    }

    input MeasureOnceInput {
        at: Datetime
        nest: ID
        diameter: Int
        radiance: Float
        chi: Int
    }

    input NestInput {
        occupant: OccupantInput!
    }

    input OccupantInput {
        name: String
        age: Int
    }

    input NamedInput {
        name: String
    }

    input AssignmentInput {
        assigned: ID!
        holder: ID!
        start: Datetime!
        end: Datetime
    }

    type Vortex @beehiveTable(table_name: "vortices", pk_column: "vortex_id") {
        vortex_id: ID!
        name: String
        timestamp: Datetime
        tags: [String!]
    }

    type VortexList {
        data: [Vortex!]
        page_info: PageInfo!
    }

    input VortexInput {
        name: String
        timestamp: Datetime
        tags: [String!]
    }

    union Item @beehiveUnion = Thing | Vortex

    type Collection @beehiveTable(table_name: "collections", pk_column: "collection_id") {
        collection_id: ID!
        items: [Item] @beehiveUnionResolver(target_types: ["Thing", "Vortex"])
    }

    type CollectionList {
        data: [Collection!]
        page_info: PageInfo!
    }

    input CollectionInput {
        items: [ID!]
    }

    type MeasureOnceList {
        info: MeasurementQueryResultInfo
        data: [MeasureOnce!]
    }

    type Query {
        things(page: PaginationInput): ThingList! @beehiveList(target_type_name: "Thing")
        findThings(query: QueryExpression!, page: PaginationInput): ThingList @beehiveQuery(target_type_name: "Thing")
        matchThings(name: String, material: String, type: TypeOfThing, page: PaginationInput): ThingList @beehiveSimpleQuery(target_type_name: "Thing")
        getThing(thing_id: String!): Thing @beehiveGet(target_type_name: "Thing")
        relatedThings(page: PaginationInput): RelatedThingsList! @beehiveList(target_type_name: "RelatedThing")
        getRelatedThing(rel_thing_id: ID): RelatedThing @beehiveGet(target_type_name: "RelatedThing")

        # assignment things
        getAssignments(page: PaginationInput): AssignmentList @beehiveList(target_type_name: "Assignment")
        # get holder
        getHolder(holder_id: ID): Holder @beehiveGet(target_type_name: "Holder")

        # nested objects
        findNests(query: QueryExpression!, page: PaginationInput): NestList @beehiveQuery(target_type_name: "Nest")

        searchVortices(query: QueryExpression!, page: PaginationInput): VortexList @beehiveQuery(target_type_name: "Vortex")
        searchCollections(query: QueryExpression!, page: PaginationInput): CollectionList @beehiveQuery(target_type_name: "Collection")

        # time series
        measureOnce(query: MeasurementQuery!): MeasureOnceList! @beehiveTimeseriesCollectionFilter(target_type_name: "MeasureOnce")
    }

    type Mutation {
        createVortex(vortex: VortexInput): Vortex! @beehiveCreate(target_type_name: "Vortex")
        createCollection(collection: CollectionInput): Collection! @beehiveCreate(target_type_name: "Collection")

        makeNest(nest: NestInput): Nest! @beehiveCreate(target_type_name: "Nest")
        newThing(thing: ThingInput): Thing! @beehiveCreate(target_type_name: "Thing")
        replaceThing(thing_id: ID!, thing: ThingInput!): Thing! @beehiveReplace(target_type_name: "Thing")
        newRelatedThing(relatedThing: RelatedThingInput): RelatedThing! @beehiveCreate(target_type_name: "RelatedThing")
        updateRelatedThing(rel_thing_id: ID!, relatedThing: RelatedThingInput!): RelatedThing! @beehiveUpdate(target_type_name: "RelatedThing")
        deleteThing(thing_id: ID): DeleteStatusResponse @beehiveDelete(target_type_name: "Thing")
        deleteThingCascading(thing_id: ID): DeleteStatusResponse @beehiveDelete(target_type_name: "Thing", cascades: [
            {target_type_name: "RelatedThing", target_field_name: "thing", isS3File: false},
            {target_type_name: "Observation", target_field_name: "thing", isS3File: false}
        ])

        # assignments
        holder(holder: NamedInput!): Holder! @beehiveCreate(target_type_name: "Holder")
        held(held: NamedInput!): Held! @beehiveCreate(target_type_name: "Held")
        assignment(assignment: AssignmentInput!): Assignment! @beehiveCreate(target_type_name: "Assignment")

        # time filtering
        observe(observation: ObservationInput): Observation! @beehiveCreate(target_type_name: "Observation")

        # tag team, back again
        tagThing(thing_id: ID!, tags: [String!]!): Thing! @beehiveListFieldAppend(target_type_name: "Thing", field_name: "tags", input_field_name: "tags")
        untagThing(thing_id: ID!, tags: [String!]!): Thing! @beehiveListFieldDelete(target_type_name: "Thing", field_name: "tags", input_field_name: "tags")

        # time series
        measureOnce(measureOnce: MeasureOnceInput): MeasureOnce @beehiveTimeseriesCollectionInsert(target_type_name: "MeasureOnce", is_multi: false)

    }

    schema @beehive(schema_name: "beehive_tests") {
        query: Query
        mutation: Mutation
    }

`
  ],
  schemaDirectives: BeehiveDirectives,
  logger: logger,
})
