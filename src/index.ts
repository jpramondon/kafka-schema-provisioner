import * as path from "path";
import * as fs from "fs";
import { KafkaSchemaProvisioner } from "./KafkaSchemaProvisioner";
import { RawAvroSchema } from "@kafkajs/confluent-schema-registry/dist/@types";
import { inspect } from "util";
import * as _ from "lodash";
import axios from "axios";

interface SchemaTopicMapping {
    schema: string;
    topics: string[];
}

interface SchemaSubjectMapping {
    schemaFile: string;
    subject: string;
}

async function waitForSchemaRegistry(registryUrl: string, max: number = 10000): Promise<void> {
    let start = Date.now();
    let stop = false;
    while (!stop) {
        stop = await axios.get(`${registryUrl}/subjects`)
            .then(result => {
                return true;
            })
            .catch(async err => {
                if (Date.now() - start > max) {
                    return Promise.reject()
                }
                console.debug("Waiting on registry to start");
                await new Promise(r => setTimeout(r, 2000));
                return false;
            });
    }
}

function findSchemaFiles(schemasLocation: string): string[] {
    if (!fs.existsSync(schemasLocation)) {
        console.error(`Folder containing schemas not found (${schemasLocation}).`);
        process.exit(1);
    }
    return fs.readdirSync(schemasLocation);
}

function readConf(configLocation: string): SchemaTopicMapping[] {
    const fullConfigPath = path.join(configLocation, "config.json");
    if (!fs.existsSync(fullConfigPath)) {
        console.error(`Configuration file ${fullConfigPath} not found.`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(fullConfigPath).toString("utf8")) as SchemaTopicMapping[];
}

function toSchemaSubjectMapping(config: SchemaTopicMapping[], schemaFiles: string[]): SchemaSubjectMapping[] {
    const result: SchemaSubjectMapping[] = [];
    config.forEach(conf => {
        if (conf.topics && conf.topics.length !== 0) {
            const schemaIndex = schemaFiles.findIndex(schema => conf.schema === schema.split('.')[0]);
            if (schemaIndex >= 0) {
                conf.topics.forEach(topic => result.push({ schemaFile: schemaFiles[schemaIndex], subject: `${topic}-value` }));
            }
        }
    });
    return result;
}

function registerSchema(schemaPath: string, subject: string): Promise<void> {
    const schema = fs.readFileSync(schemaPath).toString("utf8");
    return schemaProvisioner.registry.register(JSON.parse(schema) as RawAvroSchema, { subject })
        .then(regSchema => {
            console.debug(`Schema ${path.basename(schemaPath)} now registered with id ${regSchema.id} with subject ${subject}`);
        })
        .catch(err => {
            throw new Error(`Unable to register schema ${path.basename(schemaPath)} with subject ${subject}. Got following error: ${JSON.stringify(err)}`);
        });
}

const registryUrl = process.env.SCHEMA_REGISTRY_URL ?? "http://localhost:8081";
const registryUsername = process.env.SCHEMA_REGISTRY_USERNAME;
const registryPassword = process.env.SCHEMA_REGISTRY_PASSWORD;
const schemasLocation = process.env.SCHEMA_LOCATION ?? "/tmp/schemas";
const configLocation = process.env.CONFIG_LOCATION ?? "/tmp/config";

const config = readConf(configLocation);
const schemaFiles = findSchemaFiles(schemasLocation);
const schemaSubjectMappings = toSchemaSubjectMapping(config, schemaFiles);
console.debug(`Got a list of ${schemaFiles.length} schemas to provision in the registry`);
console.debug(`Current schema path: ${schemaFiles}`);
console.debug(`Current config: ${inspect(config)}`);
console.debug(`Schema/subject mappings: ${inspect(schemaSubjectMappings)}`);

let schemaProvisioner;

waitForSchemaRegistry(registryUrl)
    .then(() => {
        schemaProvisioner = new KafkaSchemaProvisioner(registryUrl, registryUsername, registryPassword);
        return schemaSubjectMappings.map(mapping => registerSchema(`${path.join(schemasLocation, mapping.schemaFile)}`, mapping.subject));
    })
    .then(futures => Promise.all(futures)
        .then(() => {
            console.log(`Finished registering all schemas`);
            process.exit(0);
        })
        .catch(err => {
            console.error(err.message);
            process.exit(1);
        })
    );