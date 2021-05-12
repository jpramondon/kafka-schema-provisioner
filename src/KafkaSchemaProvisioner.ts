import { SchemaRegistry } from "@kafkajs/confluent-schema-registry";
import { SchemaRegistryAPIClientArgs } from "@kafkajs/confluent-schema-registry/dist/api";
import * as _ from "lodash";

export class KafkaSchemaProvisioner {

    public registry: SchemaRegistry;

    constructor(registryUrl: string, registryUsername?: string, registryPassword?: string) {
        if (registryUrl && !_.isEmpty(registryUrl)) {
            const registryConf: SchemaRegistryAPIClientArgs = { host: registryUrl };
            if (registryUsername) {
                registryConf.auth = {
                    username: registryUsername,
                    password: registryPassword
                };
            }
            this.registry = new SchemaRegistry(registryConf);
        }
    }

}