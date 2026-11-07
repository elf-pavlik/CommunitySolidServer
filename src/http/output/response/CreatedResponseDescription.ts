import { DataFactory } from 'n3';
import { SOLID_HTTP } from '../../../util/Vocabularies';
import { RepresentationMetadata } from '../../representation/RepresentationMetadata';
import type { ResourceIdentifier } from '../../representation/ResourceIdentifier';
import { ResponseDescription } from './ResponseDescription';

/**
 * Corresponds to a 201 response, containing the relevant location metadata.
 */
export class CreatedResponseDescription extends ResponseDescription {
  public constructor(location: ResourceIdentifier, metadata?: RepresentationMetadata) {
    const result = new RepresentationMetadata(location, {
      [SOLID_HTTP.location]: DataFactory.namedNode(location.path),
    });
    if (metadata) {
      result.addQuads(metadata.quads());
    }
    super(201, result);
  }
}
