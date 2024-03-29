import * as path from "path";
import * as fs from "fs";
import { KafkaSchemaProvisioner } from "./KafkaSchemaProvisioner";
import { RawAvroSchema } from "@kafkajs/confluent-schema-registry/dist/@types";
import { inspect } from "util";
import * as _ from "lodash";
import axios from "axios";

const registryUrl = process.env.SCHEMA_REGISTRY_URL ?? "http://localhost:8081";
const registryUsername = process.env.SCHEMA_REGISTRY_USERNAME;
const registryPassword = process.env.SCHEMA_REGISTRY_PASSWORD;
const schemasLocation = process.env.SCHEMA_LOCATION ?? "/tmp/schemas";
const configLocation = process.env.CONFIG_LOCATION ?? "/tmp/config";
const registryRetryDelay = parseInt(process.env.SCHEMA_REGISTRY_RETRY_DELAY ?? "2000");
const registryMaxWaitTime = parseInt(process.env.SCHEMA_REGISTRY_MAX_WAIT_TIME ?? "10000");

interface SchemaTopicMapping {
  schema: string;
  topics: string[];
}

interface SchemaSubjectMapping {
  schemaFile: string;
  subject: string;
}

async function waitForSchemaRegistry(
  registryUrl: string,
  maxWaitTime: number = registryMaxWaitTime,
  retryDelay: number = registryRetryDelay
): Promise<void> {
  let start = Date.now();
  let stop = false;
  while (!stop) {
    stop = await axios
      .get(`${registryUrl}/subjects`)
      .then(result => {
        return true;
      })
      .catch(async err => {
        if (Date.now() - start > maxWaitTime) {
          return Promise.reject();
        }
        console.debug(`${new Date().toISOString()} - Waiting on registry to start at ${registryUrl}`);
        await new Promise(r => setTimeout(r, retryDelay));
        return false;
      });
  }
}

function findSchemaFiles(schemasLocation: string): string[] {
  if (!fs.existsSync(schemasLocation)) {
    console.error(`${new Date().toISOString()} - Folder containing schemas not found (${schemasLocation}).`);
    process.exit(1);
  }
  return fs.readdirSync(schemasLocation).filter(fileName => fileName.split(".")[1] === "avsc");
}

function readConf(configLocation: string): SchemaTopicMapping[] {
  const fullConfigPath = path.join(configLocation, "config.json");
  if (!fs.existsSync(fullConfigPath)) {
    console.error(`${new Date().toISOString()} - Configuration file ${fullConfigPath} not found.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(fullConfigPath).toString("utf8")) as SchemaTopicMapping[];
}

function toSchemaSubjectMapping(config: SchemaTopicMapping[], schemaFiles: string[]): SchemaSubjectMapping[] {
  const result: SchemaSubjectMapping[] = [];
  config.forEach(conf => {
    if (conf.topics && conf.topics.length !== 0) {
      const schemaIndex = schemaFiles.findIndex(schema => conf.schema === schema.split(".")[0]);
      if (schemaIndex >= 0) {
        conf.topics.forEach(topic =>
          result.push({
            schemaFile: schemaFiles[schemaIndex],
            subject: `${topic}-value`
          })
        );
      }
    }
  });
  return result;
}

function registerSchema(schemaPath: string, subject: string): Promise<void> {
  const schema = fs.readFileSync(schemaPath).toString("utf8");
  return schemaProvisioner.registry
    .register(JSON.parse(schema) as RawAvroSchema, { subject })
    .then(regSchema => {
      console.debug(
        `${new Date().toISOString()} - Schema ${path.basename(schemaPath)} now registered with id ${regSchema.id} with subject ${subject}`
      );
    })
    .catch(err => {
      throw new Error(
        `Unable to register schema ${path.basename(schemaPath)} with subject ${subject}. Got following error: ${JSON.stringify(err)} ${err}`
      );
    });
}

const config = readConf(configLocation);
const schemaFiles = findSchemaFiles(schemasLocation);
const schemaSubjectMappings = toSchemaSubjectMapping(config, schemaFiles);
console.debug(`${new Date().toISOString()} - Got a list of ${schemaFiles.length} schemas to provision in the registry`);
console.debug(`${new Date().toISOString()} - Current schema path: ${schemaFiles}`);
console.debug(`${new Date().toISOString()} - Current config: ${inspect(config)}`);
console.debug(`${new Date().toISOString()} - Schema/subject mappings: ${inspect(schemaSubjectMappings)}`);

let schemaProvisioner: KafkaSchemaProvisioner;

waitForSchemaRegistry(registryUrl)
  .then(() => {
    let returnCode = 0;
    schemaProvisioner = new KafkaSchemaProvisioner(registryUrl, registryUsername, registryPassword);
    schemaSubjectMappings
      .reduce<Promise<void>>((previousPromise, nextMapping) => {
        return previousPromise.then(() => {
          return registerSchema(`${path.join(schemasLocation, nextMapping.schemaFile)}`, nextMapping.subject).catch(err => {
            console.error(`${new Date().toISOString()} - ${err.message}`);
            returnCode = 1;
          });
        });
      }, Promise.resolve())
      .then(() => {
        console.log(`${new Date().toISOString()} - Finished registering all schemas`);
        process.exit(returnCode);
      });
  })
  .catch(err => {
    console.error(`${new Date().toISOString()} - Error while waiting for registry: ${inspect(err)}`);
  });
