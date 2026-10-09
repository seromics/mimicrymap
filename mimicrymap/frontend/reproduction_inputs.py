"""Read-only input/mapping contract for reproducing accepted library views.

Uses the player's existing record and mapping policy; never derives eligibility
from returned hits and never performs sequence matching.
"""
from analysis_scan import ScanError, MAX_RESULT_PAIRS


def projection_inputs(owner, records, *, library, query_id=0, query_library=None,
                      portable_id=None, projection_library=None):
    player = owner.player_service
    if portable_id:
        if projection_library not in {'panscan9_human', 'panscan9_exposure'}:
            raise ScanError(422, 'unsupported_projection_library', 'Portable queries require their exact projection library')
        query_library = projection_library
        query, children, spans, audit = player._portable_query(portable_id, query_library)
    elif query_id:
        children = player._catalog_records([query_id], expected_library=query_library)
        query = children[query_id].public()
        spans = {query_id: [dict(start0=0, end0=len(children[query_id].sequence), projection=None)]}
        audit = {'coverage_complete': True}
    else:
        raise ScanError(409, 'reproduction_query_required', 'An exact library query is required for mapped reproduction inputs')
    comparison = player._comparison(query_library, library)
    source = player._catalog_records([int(row['antigen_id']) for row in records], expected_library=library)
    mappings, entities, source_audit = player._source_plan(source, library,
        portable_query_id=portable_id, self_comparison=query_library == library,
        max_results=MAX_RESULT_PAIRS, canonical_view=False)

    def span_public(span):
        projection = span.get('projection')
        return dict(start0=span['start0'], end0=span['end0'],
                    projection=projection.public() if projection else None)

    return {
        'schema': 'mimicryone/reproduction-projections/1',
        'comparison': comparison.key,
        'query': query,
        'query_portable_id': portable_id,
        'query_children': [dict(record=record.public(), mappings=[span_public(s) for s in spans[key]])
                           for key, record in sorted(children.items())],
        'parent_children': [dict(record=record.public(), mappings=[dict(
            output_key=str(entities[m['entity_key']]['record']['protein_idx']),
            start0=m['start0'], end0=m['start0']+len(record.sequence),
            mapping_status=m['mapping_status'],
            projection=m['projection'].public() if m.get('projection') else None)
            for m in mappings.get(key, [])]) for key, record in sorted(source.items())],
        'parent_entities': [entity['record'] for entity in entities.values()],
        'query_audit': audit,
        'parent_audit': source_audit,
        'pair_policy': 'exclude_identical_native_record',
        'selection_basis': 'complete_selected_input_page_not_hit_candidates',
    }


def projection_references(plan):
    """Metadata page for a browser that already holds prepared input sequences."""
    records = [child['record'] for child in plan['parent_children']]
    by_sequence = {record['sequence']: int(record['antigen_id']) for record in records}

    def reference(record):
        sequence = record.get('sequence')
        if sequence not in by_sequence:
            return dict(record)  # Additional full reference, absent from this input page.
        return {**{key: value for key, value in record.items() if key != 'sequence'},
                'sequence_ref': by_sequence[sequence]}

    return {**plan, 'transport': 'prepared-input-references/1',
            'parent_children': [{**child, 'record': reference(child['record'])}
                                for child in plan['parent_children']],
            'parent_entities': [reference(record) for record in plan['parent_entities']]}
