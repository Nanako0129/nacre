'use strict';
'require view';
'require form';

return view.extend({
	render: function() {
		var m, s, o;

		m = new form.Map('nacre', _('nacre'), _('Appearance settings for the nacre theme.'));

		s = m.section(form.NamedSection, 'global', 'global');

		o = s.option(form.ListValue, 'mode', _('Color mode'));
		o.value('auto', _('Follow system'));
		o.value('light', _('Light'));
		o.value('dark', _('Dark'));
		o.default = 'auto';

		return m.render();
	}
});
