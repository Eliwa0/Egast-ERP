from django.db import migrations


def move_grades(apps, schema_editor):
    Category = apps.get_model('api', 'QualityCategory')
    Criterion = apps.get_model('api', 'QualityCriterion')
    database = schema_editor.connection.alias
    category, _ = Category.objects.using(database).get_or_create(code='GRADE', defaults={
        'name_ar': 'درجات الجودة', 'name_en': 'Quality Grades',
        'sort_order': 40, 'is_active': True,
    })
    # Keep criterion identities, activation, stages and every existing item mapping.
    Criterion.objects.using(database).filter(
        calculation_key__in=['grade_1', 'grade_2']).update(category_id=category.pk)


class Migration(migrations.Migration):
    dependencies = [('api', '0063_production_pallet_types')]
    operations = [migrations.RunPython(move_grades, migrations.RunPython.noop)]
