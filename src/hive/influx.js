const Influx = require('influx');

const INFLUX_DB_HOST = process.env.INFLUX_DB_HOST


function mapType(type) {
    switch(String(type.type)) {
        case "Int":
            return Influx.FieldType.INTEGER
        case "Boolean":
            return Influx.FieldType.BOOLEAN
        case "Float":
            return Influx.FieldType.FLOAT
        case "String":
        default:
            return Influx.FieldType.STRING
    }
}


exports.configureClient = async function(schema) {
    var influxSchema = []
    console.log("configuring influxdb client")

    for (var type of Object.keys(schema._beehive.measurements)) {
        const measurement = schema._beehive.measurements[type]
        console.log(measurement)
        
        var fields = {
            time: Influx.FieldType.STRING
        }

        for (var field_name of measurement.measurement_fields) {
            fields[field_name] = mapType(measurement.type._fields[field_name])
        }
        influxSchema.push({
            measurement: measurement.measurement_name,
            fields: fields,
            tags: measurement.tag_fields,
        })
    }

    var influx = new Influx.InfluxDB({
        host: INFLUX_DB_HOST,
        database: schema._beehive.influx_db_name,
        schema: influxSchema,
    })

    schema.influxClient = influx

    await (async function() {
        influx.getDatabaseNames()
            .then(names => {
                if (!names.includes(schema._beehive.influx_db_name)) {
                    console.log(`database ${schema._beehive.influx_db_name} being created`)
                    return influx.createDatabase('beehive')
                } else {
                    console.log(`database ${schema._beehive.influx_db_name} exists`)
                    return
                }
            })
            .catch(err => {
                console.log(err)
                console.error(`Error creating Influx::${schema._beehive.influx_db_name} database!`)
            })
    })

}

exports.insertMeasurement = async function(schema, measurement_config, input) {
    var tags = {}
    for (var field_name of measurement_config.tag_fields) {
        tags[field_name] = input[field_name]
    }
    var fields = {}
    for (var field_name of Object.keys(measurement_config.type._fields)) {
        if(field_name == measurement_config.time_field) {
            if(input[field_name]) {
                fields.time = new Date(input[field_name])
            } else {
                fields.time = new Date()
            }
        } else if (measurement_config.measurement_fields.includes(field_name)) {
            fields[field_name] = input[field_name]
        }
    }
    console.log({
                measurement: measurement_config.measurement_name,
                tags: tags,
                fields: fields,
            })
    await schema.influxClient.writePoints([
            {
                measurement: measurement_config.measurement_name,
                tags: tags,
                fields: fields,
            }
        ]).catch(err => {
            console.error(`Error saving data to InfluxDB! ${err.stack}`)
        })
    input[measurement_config.time_field] = fields.time
    return input
}

function prepareProjections(measurements) {
    var bits = []
    for (var func of measurements) {
        if(!func.function || func.function == "none") {
            bits.push(`"${func.field}"`)
        } else {
            bits.push(`${func.function}("${func.field}") AS "${func.field}_${func.function}"`)
        }
    }
    return bits.join(",")
}

function prepareWhere(query) {
    return ""
}

function prepareGroupBy(query) {
    if(query.interval) {
        return `GROUP BY time(${query.interval})`
    } else {
        return ""
    }
}

function handleResults(measurements, from_db) {
    console.log(measurements)
    var result = []
    for (var func of measurements) {
        var measurement = {
            field: func.field,
            function: func.function,
            data: [],
            name: "",
        }
        var name = `${func.field}`
        if(func.function && func.function != "none") {
            name = `${func.field}_${func.function}`
        }
        measurement.name = name
        for(var row of from_db) {
            console.log(row.time.toNanoISOString())
            console.log(row.time)
            measurement.data.push({
                time: row.time.toNanoISOString(),
                value: row[name],
                // type: "",
            })
        }
        result.push(measurement)
    }
    return result
}

exports.filterMeasurements = async function(schema, measurement_config, query) {
    try {
        var iql = `SELECT ${prepareProjections(query.measurements)} FROM "${schema._beehive.influx_db_name}"."autogen"."${measurement_config.measurement_name}" ${prepareWhere(query)} ${prepareGroupBy(query)} FILL(null)`
        console.log(iql)
        var results = await schema.influxClient.query(iql)
        console.log(results)
        var resultObj = {
            status: "ok",
            data: handleResults(query.measurements, results),
        }
        // console.log(resultObj)
        if(query.before) {
            resultObj.before = query.before
        }
        if(query.after) {
            resultObj.after = query.after
        }
        if(query.interval) {
            resultObj.interval = query.interval
        }
        return resultObj
    } catch(err) {
        return {status: "error", error: `error occurred ${err}`}
    }
}

