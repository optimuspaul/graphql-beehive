const {SchemaDirectiveVisitor} = require('graphql-tools')
const {insertType, listType, getItem, getRelatedItems, getRelatedItemsFiltered, putType, patchType, queryType, simpleQueryType, inferType, deleteType, deleteRelations, appendToListField, deleteFromListField} = require("./pgsql")
const {insertMeasurement, filterMeasurements, mapType} = require("./influx")
const drones = require("./drones")

const EVENTS = process.env.BEEHIVE_ENABLE_EVENTS == "yes"

var graphS3

try {
    graphS3 = require("@wildflowerschools/graphql-s3-directive")
} catch(err) {
    // not a problem, unless you want to use the s3-directive
}


exports.BeehiveTypeDefs = `
    # ISO formated Date Timestamp
    scalar Datetime

    enum TableType {
        jsonb
        native
    }

    enum NativeIndexType {
        btree
        hash
        gist
        gin
    }

    input NativeIndex {
        name: String!
        type: NativeIndexType!
        columns: [String!]
    }

    directive @beehive (schema_name: String) on SCHEMA
    directive @beehive (schema_name: String, influx_db_name: String) on SCHEMA

    # partition is only valid on a native table type.
    directive @beehiveTable(table_name: String, pk_column: String, resolve_type_field: String, table_type: TableType, partition: String, native_indexes: [NativeIndex!], native_exclude: [String!]) on OBJECT | INTERFACE

    directive @beehiveIndexed(target_type_name: String!) on FIELD_DEFINITION

    directive @beehiveCreate(target_type_name: String!, s3_file_fields: [String!]) on FIELD_DEFINITION

    directive @beehiveUpdate(target_type_name: String!, s3_file_fields: [String!]) on FIELD_DEFINITION

    directive @beehiveListFieldAppend(target_type_name: String!, field_name: String!, input_field_name: String) on FIELD_DEFINITION

    directive @beehiveListFieldDelete(target_type_name: String!, field_name: String!, input_field_name: String) on FIELD_DEFINITION

    directive @beehiveReplace(target_type_name: String!, s3_file_fields: [String!]) on FIELD_DEFINITION

    directive @beehiveList(target_type_name: String!) on FIELD_DEFINITION

    directive @beehiveRelation(target_type_name: String!, target_field_name: String) on FIELD_DEFINITION

    directive @beehiveAssignmentType(table_name: String, pk_column: String, assigned_field: String!, assignee_field: String, start_field_name: String, end_field_name: String, exclusive: Boolean) on OBJECT

    directive @beehiveUnion on UNION

    directive @beehiveUnionResolver(target_types: [String!], target_field_names: [String]) on FIELD_DEFINITION

    directive @beehiveQuery(target_type_name: String!) on FIELD_DEFINITION

    directive @beehiveSimpleQuery(target_type_name: String!) on FIELD_DEFINITION

    directive @beehiveGet(target_type_name: String!) on FIELD_DEFINITION

    directive @beehiveAssignmentFilter(target_type_name: String!, assignee_field: String, start_field_name: String, end_field_name: String) on FIELD_DEFINITION

    directive @beehiveRelationFilter(target_type_name: String!, target_field_name: String) on FIELD_DEFINITION

    directive @beehiveRelationTimeFilter(target_type_name: String!, target_field_name: String, timestamp_field_name: String) on FIELD_DEFINITION

    directive @beehiveDelete(target_type_name: String, cascades: [CascadeLink!]) on FIELD_DEFINITION

    directive @beehiveDeleteList(target_type_name: String, cascades: [CascadeLink!]) on FIELD_DEFINITION

    # tags an object to have a timeseries index created for it
    directive @beehiveTimeseriesCollection(measurement_name: String!) on OBJECT

    # tags an field to be included in a time series measurement
    directive @beehiveMeasurement(measurement_name: String!, type: TSFieldType!) on FIELD_DEFINITION

    directive @beehiveTimeseriesCollectionFilter(target_type_name: String!) on FIELD_DEFINITION

    directive @beehiveTimeseriesCollectionInsert(target_type_name: String!, is_multi: Boolean) on FIELD_DEFINITION

    enum TSFieldType {
        Timestamp
        Measurement
        Tag
    }

    enum SortDirection {
        ASC
        DESC
    }

    input PaginationInput {
        max: Int
        cursor: String
        sort: [SortInput!]
    }

    input SortInput {
        field: String!
        direction: SortDirection
    }

    type Sort {
        field: String!
        direction: SortDirection!
    }

    type PageInfo {
        total: Int
        count: Int
        max: Int
        cursor: String
        sort: [Sort!]
    }

    type System {
        type_name: String!
        created: Datetime!
        last_modified: Datetime
    }

    type _beehive_helper_ {
        system: System!
        assignmentFilter(at: Datetime, current: Boolean, page: PaginationInput): Boolean
        tsFilter(since: Datetime, before: Datetime, page: PaginationInput): Boolean
        relationFilter(query: QueryExpression, page: PaginationInput): Boolean
    }

    enum Operator {
        OR
        AND
        NOT
        EQ
        NE
        LIKE
        RE
        IN
        LT
        GT
        LTE
        GTE
        ISNULL
        NOTNULL
        CONTAINS
        CONTAINED_BY
    }

    input QueryExpression {
        field: String
        operator: Operator!
        value: String
        values: [String!]
        children: [QueryExpression!]
    }

    enum Status {
        ok
        error
    }

    type DeleteStatusResponse {
        status: Status!
        error: String
    }

    enum MeasurementFunctionName {
        mean
        median
        count
        min
        max
        sum
        first
        last
        stddev
        spread
        none
    }

    input MeasurementFieldFunction {
        function: MeasurementFunctionName
        field: String!
    }

    input MeasurementQuery {
        before: Datetime
        after: Datetime
        query: QueryExpression
        interval: String
    }

    type MeasurementQueryResultInfo {
        status: Status!
        error: String
        before: Datetime
        after: Datetime
        interval: String
    }

    type ScalarData {
        time: Datetime
        value: String
        # type: String
    }

    type MeasurementQueryResult {
        name: String!
        function: MeasurementFunctionName
        field: String!
        data: [ScalarData]
    }

    input CascadeLink {
        target_type_name: String!
        target_field_name: String!
        isS3File: Boolean
    }

`

if (graphS3) {
    exports.BeehiveTypeDefs += graphS3.typeDefs
}

function findIdField(obj) {
    for (var field_name of Object.keys(obj._fields)) {
        if (obj._fields[field_name].type == "ID!") {
            return field_name
        }
    }
    return "id"
}

function isListType(type) {
    if(type.kind == "ListType") { return true }
    if(type.kind == "NonNullType") {
        if(type.type && type.type.kind == "ListType") {
            return true
        }
    }
    return false
}


exports.findIdField = findIdField


class BeehiveDirective extends SchemaDirectiveVisitor {

    visitObject(type) {
        var table_config = {
            type: type,
            table_name: type.name,
            pk_column: this.args.pk_column,
            table_type: this.args.table_type,
            partition: this.args.partition,
            indexes: this.args.native_indexes,
            native_exclude: this.args.native_exclude,
        }


        if(!this.args.native_exclude) {
            table_config.native_exclude = []
        }

        if(!this.args.table_type) {
            table_config["table_type"] = "jsonb"
        }

        if(!this.args.pk_column) {
            table_config["pk_column"] = findIdField(type)
        }

        if(this.args.table_name) {
            table_config["table_name"] = this.args.table_name
        }

        type._fields.system = this.schema._typeMap._beehive_helper_._fields.system

        this.schema._beehive.tables[type.name] = table_config
        this.schema._beehive.lctypemap[type.name.toLowerCase()] = type.name
    }

    visitInterface(type) {
        // visit the object to get all the benefits of table creation
        this.visitObject(type)

        // beehive is brought into scope for the resolveType function
        const _beehive = this.schema._beehive
        // field to use to do a type resolution
        const resolve_type_field = this.args.resolve_type_field
        type.resolveType = async function(obj, context, info) {
            // this is the actual resolver
            // if the resolve_type_field is set then we do a lookup on the object
            // and the lctypemap to determine the actual type
            if(resolve_type_field) {
                var resolvedType = obj[resolve_type_field]
                resolvedType = _beehive.lctypemap[resolvedType.toLowerCase()]
                return resolvedType
            }
            // otherwise, we just return the type name, it most cases this doesn't help since it will always be equal to the interface name
            // TODO: maybe that statement isn't true, maybe if the target type on the create is the actual type and not the interface then it
            //   will actually be able to resolve to the correct type but still share a table.
            return obj.system.type_name
        }
    }

    visitSchema(schema) {
        schema._beehive = {
            schema_name: (this.args.schema_name ? this.args.schema_name : "beehive"),
            influx_db_name: (this.args.influx_db_name ? this.args.influx_db_name : "beehive"),
            tables: [],
            lctypemap: [],
            indexes: [],
            measurements: [],
        }
    }

    visitFieldDefinition(field, details) {
        const target_type_name = this.args.target_type_name
        var index_config = {
            target_type_name: target_type_name,
            field: field,
        }
        this.schema._beehive.indexes.push(index_config)
    }

}


class BeehiveCreateDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const target_type_name = this.args.target_type_name
        const inputName = target_type_name.charAt(0).toLowerCase() + target_type_name.slice(1)
        const schema = this.schema
        const s3FileFields = this.args.s3_file_fields

        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]

            if(!table_config) {
                throw Error(`Table definition (${target_type_name}) not found by beehive.`)
            }
            const input = args[inputName]
            if(!input) {
                throw Error(`Input not found as expected (${inputName}) [${JSON.stringify(args)}] by beehive.`)
            }
            if(s3FileFields) {
                await graphS3.processS3Files(input, s3FileFields, target_type_name, schema)
            }
            return new Promise(async function(resolve, reject) {
                try {
                    var result = await insertType(schema, table_config, input)
                    if(EVENTS) {
                        const evt = new drones.Event("beehive-object-lifecycle", target_type_name, result[table_config.pk_column], "CREATE")
                        try {
                            await drones.sendEvent(evt)
                            resolve(result)
                        } catch(err) {
                            console.log(err)
                            // TODO - do something about lost events
                            resolve(result)
                        }
                    } else {
                        resolve(result)
                    }
                } catch(err) {
                    reject(err)
                }
            })
        }
    }

}

class BeehiveReplaceDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const target_type_name = this.args.target_type_name
        const inputName = target_type_name.charAt(0).toLowerCase() + target_type_name.slice(1)
        const schema = this.schema
        const s3FileFields = this.args.s3_file_fields

        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            var input = args[inputName]
            if(!input) {
                throw Error(`Input not found as expected (${inputName}) by beehive.`)
            }
            if(s3FileFields) {
                await graphS3.processS3Files(input, s3FileFields, target_type_name, schema)
            }
            return new Promise(async function(resolve, reject) {
                try {
                    var result = await putType(schema, table_config, args[table_config.pk_column], input)
                    if(EVENTS) {
                        const evt = new drones.Event("beehive-object-lifecycle", target_type_name, args[table_config.pk_column], "UPDATE")
                        try {
                            await drones.sendEvent(evt)
                            resolve(result)
                        } catch(err) {
                            console.log(err)
                            // TODO - do something about lost events
                            resolve(result)
                        }
                    } else {
                        resolve(result)
                    }
                } catch(err) {
                    reject(err)
                }
            })
        }
    }
}

class BeehiveUpdateDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const target_type_name = this.args.target_type_name
        const inputName = target_type_name.charAt(0).toLowerCase() + target_type_name.slice(1)
        const schema = this.schema
        const s3FileFields = this.args.s3_file_fields

        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            var input = args[inputName]
            if(!input) {
                throw Error(`Input not found as expected (${inputName}) by beehive.`)
            }
            if(s3FileFields) {
                await graphS3.processS3Files(input, s3FileFields, target_type_name, schema)
            }
            return new Promise(async function(resolve, reject) {
                try {
                    var result = await patchType(schema, table_config, args[table_config.pk_column], input)
                    if(EVENTS) {
                        const evt = new drones.Event("beehive-object-lifecycle", target_type_name, args[table_config.pk_column], "UPDATE")
                        try {
                            await drones.sendEvent(evt)
                            resolve(result)
                        } catch(err) {
                            console.log(err)
                            // TODO - do something about lost events
                            resolve(result)
                        }
                    } else {
                        resolve(result)
                    }
                } catch(err) {
                    reject(err)
                }
            })
        }
    }

}


class BeehiveListDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const target_type_name = this.args.target_type_name
        const schema = this.schema

        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            return listType(schema, table_config, args.page)
        }
    }

}

class BeehiveQueryDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const target_type_name = this.args.target_type_name
        const schema = this.schema

        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            return queryType(schema, table_config, args.query, args.page)
        }
    }

}

class BeehiveSimpleQueryDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const target_type_name = this.args.target_type_name
        const schema = this.schema

        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            var query = {}

            for (var field_name of Object.keys(args)) {
                if(field_name != "page") {
                    query[field_name] = args[field_name]
                }
            }

            return simpleQueryType(schema, table_config, query, args.page)
        }
    }

}

class BeehiveGetDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const target_type_name = this.args.target_type_name
        const schema = this.schema

        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            return getItem(schema, table_config, args[table_config.pk_column])
        }
    }

}

class BeehiveRelationDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const target_type_name = this.args.target_type_name
        const this_object_type = details.objectType
        const schema = this.schema
        const field_name = field.name
        const target_field_name = this.args.target_field_name

        const isListField = isListType(field.astNode.type)

        field.resolve = async function (obj, args, context, info) {
            console.log(`loading a relation ${target_type_name}-> ${this_object_type}? ${isListField}`)
            const table_config = schema._beehive.tables[target_type_name]
            if(isListField) {
                const local_table_config = schema._beehive.tables[this_object_type]
                console.log(`loading a relation ${target_type_name}->[${this_object_type}] ${local_table_config}`)
                return getRelatedItems(schema, table_config, target_field_name, obj[local_table_config.pk_column])
            } else {
                console.log(`loading a relation ${target_type_name}->${this_object_type} ${obj[field_name]}`)
                return getItem(schema, table_config, obj[field_name])
            }
        }
    }

}


class BeehiveUnionDirective extends SchemaDirectiveVisitor {
    visitUnion(union) {
        union.resolveType = async function(obj, context, info) {
            // This doesn't actually work. TED +1
            return obj.system.type_name
        }
    }

    visitFieldDefinition(field, details) {
        const target_types = this.args.target_types
        const target_field_names = this.args.target_field_names
        const this_object_type = details.objectType

        const schema = this.schema
        const field_name = field.name

        const isListField = isListType(field.astNode.type)

        field.resolve = async function (obj, args, context, info) {
            console.log(`looking for a relation that is a UNION ${field_name} could be ${target_types}`)
            // console.log(obj)
            if(isListField) {
                // console.log("it's a vector")
                var promises = []
                for(var list_item of obj[field_name]) {
                    var infered_item_type = await inferType(schema, list_item)
                    if(infered_item_type) {
                        var table_config = schema._beehive.tables[infered_item_type]
                        promises.push(getItem(schema, table_config, list_item))
                    }
                }
                return Promise.all(promises)
            } else {
                // console.log("it's a scalar")
                const infered_type = await inferType(schema, obj[field_name])
                // console.log(`infered_type ${infered_type}`)
                if(infered_type) {
                    var table_config = schema._beehive.tables[infered_type]
                    return getItem(schema, table_config, obj[field_name])
                }
                return null
            }
        }
    }
}


class BeehiveAssignmentTypeDirective extends SchemaDirectiveVisitor {

    visitObject(type) {
        // TODO - extend to native tables
        var table_config = {
            is_assignment: true,
            table_type: "jsonb",
            partition: null,
            type: type,
            table_name: type.name,
            pk_column: this.args.pk_column,
            assigned_field: this.args.assigned_field,
            assignee_field: this.args.assignee_field,
            exclusive: this.args.exclusive,
            start_field_name: "start",
            end_field_name: "end",
        }

        if(!this.args.pk_column) {
            table_config["pk_column"] = findIdField(type)
        }

        if(this.args.table_name) {
            table_config["table_name"] = this.args.table_name
        }

        if(this.args.start_field_name) {
            table_config["start_field_name"] = this.args.start_field_name
        }

        if(this.args.end_field_name) {
            table_config["end_field_name"] = this.args.end_field_name
        }

        type._fields.system = this.schema._typeMap._beehive_helper_._fields.system

        this.schema._beehive.tables[type.name] = table_config
        this.schema._beehive.lctypemap[type.name.toLowerCase()] = type.name
    }

}


class BeehiveAssignmentFilterDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        field.args = this.schema._typeMap._beehive_helper_._fields.assignmentFilter.args
        const schema = this.schema
        const target_type_name = this.args.target_type_name
        const assignee_field = this.args.assignee_field
        const this_object_type = details.objectType

        const start_field_name = this.args.start_field_name ? this.args.start_field_name : "start"
        const end_field_name = this.args.end_field_name ? this.args.end_field_name : "end"

        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            const local_table_config = schema._beehive.tables[this_object_type]
            if(args && (args.current || args.at)) {
                var query = {
                    operator: "AND",
                    children: [],
                }
                if(args.current) {
                    // NEED TEST
                    const now = new Date().toISOString()
                    query.children.push({field: start_field_name, operator: "LTE", value: now})
                    query.children.push({operator: "OR", children: [
                            {field: end_field_name, operator: "ISNULL"},
                            {field: end_field_name, operator: "GTE", value: now},
                        ]
                    })
                } else if(args.at) {
                    // NEED TEST
                    query.children.push({field: start_field_name, operator: "GTE", value: args.at})
                    query.children.push({field: end_field_name, operator: "LTE", value: args.at})
                }
                return getRelatedItemsFiltered(schema, table_config, assignee_field, obj[local_table_config.pk_column], query, args.page)
            } else {
                // treat as a normal relation
                return getRelatedItems(schema, table_config, assignee_field, obj[local_table_config.pk_column], args.page)
            }

        }

    }

}

class BeehiveRelationTimeFilterDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        field.args = this.schema._typeMap._beehive_helper_._fields.tsFilter.args
        const schema = this.schema
        const target_type_name = this.args.target_type_name
        const target_field_name = this.args.target_field_name
        const this_object_type = details.objectType

        const timestamp_field_name = this.args.timestamp_field_name ? this.args.timestamp_field_name : "timestamp"

        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            const local_table_config = schema._beehive.tables[this_object_type]
            if(args) {
                var query = {
                    operator: "AND",
                    children: [],
                }
                if(args.since) {
                    query.children.push({
                        field: timestamp_field_name,
                        operator: "GTE",
                        value: args.since,
                    })
                }
                if(args.before) {
                    query.children.push({
                        field: timestamp_field_name,
                        operator: "LT",
                        value: args.before,
                    })
                }
                return getRelatedItemsFiltered(schema, table_config, target_field_name, obj[local_table_config.pk_column], query, args.page)
            } else {
                // treat as a normal relation
                return getRelatedItems(schema, table_config, target_field_name, obj[local_table_config.pk_column], args.page)
            }

        }

    }

}

class BeehiveRelationFilterDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        field.args = this.schema._typeMap._beehive_helper_._fields.relationFilter.args
        const schema = this.schema
        const target_type_name = this.args.target_type_name
        const target_field_name = this.args.target_field_name
        const this_object_type = details.objectType

        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            const local_table_config = schema._beehive.tables[this_object_type]
            if(args) {
                const query = args.query
                return getRelatedItemsFiltered(schema, table_config, target_field_name, obj[local_table_config.pk_column], query, args.page)
            } else {
                // treat as a normal relation
                return getRelatedItems(schema, table_config, target_field_name, obj[local_table_config.pk_column], args.page)
            }

        }

    }

}

class BeehiveListFieldAppendDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const schema = this.schema
        const target_type_name = this.args.target_type_name
        const field_name = this.args.field_name
        const input_field_name = this.args.input_field_name ? this.args.input_field_name : this.args.field_name
        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            var input = args[input_field_name]
            return appendToListField(schema, table_config, args[table_config.pk_column], field_name, input)
        }
    }

}
class BeehiveListFieldDeleteDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const schema = this.schema
        const target_type_name = this.args.target_type_name
        const field_name = this.args.field_name
        const input_field_name = this.args.input_field_name ? this.args.input_field_name : this.args.field_name
        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            var input = args[input_field_name]
            return deleteFromListField(schema, table_config, args[table_config.pk_column], field_name, input)
        }
    }

}


async function performDelete(cascades, schema, table_config, pk) {
    if(cascades) {
        for(var i in cascades) {
            try {
                var cascade = cascades[i]
                console.log(cascade)
                var rel_table_config = schema._beehive.tables[cascade.target_type_name]
                deleteRelations(schema, rel_table_config, cascade.target_field_name, pk)
            } catch(e) {
                console.log(e)
            }
        }
    }
    // do the delete
    if(deleteType(schema, table_config, pk)) {
        return {
            status: "ok",
        }
    } else {
        return {
            status: "error",
            error: "Nothing deleted",
        }
    }

}


class BeehiveDeleteDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const schema = this.schema
        const target_type_name = this.args.target_type_name
        const cascades = this.args.cascades

        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            const pk = args[table_config.pk_column]
            return performDelete(cascades, schema, table_config, pk)
        }

    }

}

class BeehiveTimeseriesCollectionDirective extends SchemaDirectiveVisitor {

    visitObject(type) {
        var measurement_config = {
            type: type,
            measurement_name: this.args.measurement_name,
            time_field: null,
            tag_fields: [],
            measurement_fields: [],
        }
        if(!measurement_config.time_field) {
            for (var field_name of Object.keys(type._fields)) {
                var tt = String(type._fields[field_name].type)
                if(tt == "Datetime!" || tt == "Datetime") {
                    measurement_config.time_field = field_name
                    break
                }
            }
        }
        // console.log("----------------------+++||_^_||+++----------------------")
        // console.log("-----------++++++++++++++||•|•||++++++++++++++-----------")
        // console.log("----------------+++++++++|| - ||+++++++++----------------")
        // console.log("----------------------+++||___||+++----------------------")
        // console.log(measurement_config)
        // console.log("-------------------M==+++||   ||+++==M-------------------")
        // console.log("----------------------+++|| | ||+++----------------------")
        // console.log("------------------+++++++||_^_||+++++++------------------")
        this.schema._beehive.measurements[type.name] = measurement_config
        this.schema._beehive.lctypemap[type.name.toLowerCase()] = type.name
    }

}


const functions = [
        "mean",
        "median",
        "count",
        "min",
        "max",
        "sum",
        "first",
        "last",
        "stddev",
        "spread",
]

function makeFunctionFor(field, fname) {
    var copied = Object.assign({}, field)
    copied.name = `${fname}_${field.name}`
    delete copied.astNode
    return copied
}

class BeehiveTimeseriesMeasuementDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const measurement_name = this.args.measurement_name
        const type = this.args.type
        const schema = this.schema

        // console.log("----------------------+++||   ||+++----------------------")
        // console.log(field)

        var measurement_config = schema._beehive.measurements[type.name]
        if(!measurement_config) {
            measurement_config = schema._beehive.measurements[type.name] = {
                type: details.objectType,
                measurement_name: measurement_name,
                time_field: null,
                tag_fields: [],
                measurement_fields: [],
            }
        }

        if(type=="Timestamp") {
            measurement_config.time_field = field.name
        } else if(type=="Tag") {
            measurement_config.tag_fields.push(field.name)
        } else if(type=="Measurement") {
            measurement_config.measurement_fields.push(field.name)
            // var fieldDef = details.objectType._fields[field]

            for(var fname of functions) {
                var newField = makeFunctionFor(field, fname)
                details.objectType._fields[newField.name] = newField
           }
        }
    }


}


class BeehiveTimeseriesCollectionFilterDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const target_type_name = this.args.target_type_name
        const inputName = target_type_name.charAt(0).toLowerCase() + target_type_name.slice(1)
        const schema = this.schema

        field.resolve = async function (obj, args, context, info) {
            const measurement_config = schema._beehive.measurements[target_type_name]
            if(args && args.query) {
                const query = args.query
                return filterMeasurements(schema, measurement_config, query)
            } else {
                return {
                    status: "error",
                    error: "query is required to query a measurement",
                }
            }
        }
    }

}

class BeehiveTimeseriesCollectionInsertDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const target_type_name = this.args.target_type_name
        const inputName = target_type_name.charAt(0).toLowerCase() + target_type_name.slice(1)
        const schema = this.schema

        field.resolve = async function (obj, args, context, info) {
            const measurement_config = schema._beehive.measurements[target_type_name]

            var input = args[inputName]
            if(!input) {
                throw Error(`Input not found as expected (${inputName}) by beehive.`)
            }

            return insertMeasurement(schema, measurement_config, input)
        }
    }

}



// untested code
class BeehiveDeleteListDirective extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const schema = this.schema
        const target_type_name = this.args.target_type_name
        const cascades = this.args.cascades

        field.resolve = async function (obj, args, context, info) {
            const table_config = schema._beehive.tables[target_type_name]
            const pks = args[table_config.pk_column]
            for(var pk in pks) {
                performDelete(cascades, schema, table_config, pk)
            }
        }

    }
}
// ^^ untested code


exports.BeehiveDirectives = {
    beehive: BeehiveDirective,
    beehiveTable: BeehiveDirective,
    beehiveCreate: BeehiveCreateDirective,
    beehiveList: BeehiveListDirective,
    beehiveQuery: BeehiveQueryDirective,
    beehiveSimpleQuery: BeehiveSimpleQueryDirective,
    beehiveGet: BeehiveGetDirective,
    beehiveRelation: BeehiveRelationDirective,
    beehiveUnion: BeehiveUnionDirective,
    beehiveUnionResolver: BeehiveUnionDirective,
    beehiveReplace: BeehiveReplaceDirective,
    beehiveUpdate: BeehiveUpdateDirective,
    beehiveIndexed: BeehiveDirective,
    beehiveAssignmentType: BeehiveAssignmentTypeDirective,
    beehiveAssignmentFilter: BeehiveAssignmentFilterDirective,
    beehiveRelationFilter: BeehiveRelationFilterDirective,
    beehiveRelationTimeFilter: BeehiveRelationTimeFilterDirective,
    beehiveDelete: BeehiveDeleteDirective,
    beehiveDeleteList: BeehiveDeleteListDirective,
    beehiveListFieldAppend: BeehiveListFieldAppendDirective,
    beehiveListFieldDelete: BeehiveListFieldDeleteDirective,
    beehiveTimeseriesCollection: BeehiveTimeseriesCollectionDirective,
    beehiveMeasurement: BeehiveTimeseriesMeasuementDirective,
    beehiveTimeseriesCollectionFilter: BeehiveTimeseriesCollectionFilterDirective,
    beehiveTimeseriesCollectionInsert: BeehiveTimeseriesCollectionInsertDirective,
};

if (graphS3) {
    exports.BeehiveDirectives = Object.assign(exports.BeehiveDirectives, graphS3.directives)
}
