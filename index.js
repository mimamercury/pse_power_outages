import * as path from 'path'
import * as turf from '@turf/helpers'
import { fetchJson } from '@editorialapp/datatools/fetch'
import { readJson, writeJson } from '@editorialapp/datatools/json'
import { slugify } from '@editorialapp/datatools/text'
import * as dirname from '@editorialapp/datatools/dirname'

const data_directory = dirname.join(import.meta.url, 'data')
const source_directory = path.join(data_directory, 'source')
const processed_directory = path.join(data_directory, 'processed')
const metadata_filepath = path.join(data_directory, 'metadata.json')

const metadata = await readJson(metadata_filepath)
const previous_updated_time = metadata.last_updated

let response
try {
    response = await fetchJson('https://www.pse.com/api/sitecore/OutageMap/AnonymoussMapListView')
} catch (error) {
    console.error('Error fetching outage data', error)
    process.exit(1)
}

const new_updated_time = response.LastUpdated

if (new_updated_time === previous_updated_time) {
    console.error('No new data', new_updated_time, previous_updated_time)
    process.exit(0)
}

metadata.last_updated = new_updated_time

const source_filepath = path.join(source_directory, `power_outages_${slugify(new_updated_time)}.json`)
const processed_filepath = path.join(processed_directory, `power_outages_${slugify(new_updated_time)}.geojson`)

const properties = format_metadata(response)
const collection = create_feature_collection(response.PseMap, properties)

await writeJson(source_filepath, response)
await writeJson(processed_filepath, collection)
await writeJson(metadata_filepath, metadata)

function format_metadata (response) {
    return {
        customers_affected: response.Common.CustomerAfftectedCount,
        outage_count: response.Common.OutageCount,
        last_updated: response.LastUpdated
    }
}

function create_feature_collection (polygons, properties) {
    const features = []

    for (const { DataProvider, Polygon } of polygons) {
        features.push(polygon_to_feature(Polygon, DataProvider))
    }

    const collection = turf.featureCollection(features)
    collection.properties = properties
    return collection
}

function polygon_to_feature (polygon, dataProvider) {
    const properties = {
        id: dataProvider.PointOfInterest.Id,
        point_of_interest: turf.point([dataProvider.PointOfInterest.Longitude, dataProvider.PointOfInterest.Latitude]),
        title: dataProvider.PointOfInterest.Title,
        planned_outage: dataProvider.PointOfInterest.planned_outage
    }

    for (const attribute of dataProvider.Attributes) {
        const slug = slugify(attribute.Name)
        properties[slug] = {
            id: slug,
            name: attribute.Name,
            value: attribute.Value,
            no_display: attribute.NoDisplay
        }
    }

    const coordinates = polygon.map(({ Longitude, Latitude }) => {
        return [Number(Longitude), Number(Latitude)]
    })

    return turf.polygon([coordinates], properties)
}
