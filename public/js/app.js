(function () {
  // ---- Donation form: show only the fields for the chosen donation type ----
  var form = document.getElementById('donate-form');
  if (form) {
    var radios = form.querySelectorAll('input[name="donation_type"]');
    var sections = form.querySelectorAll('.type-section');
    var labels = form.querySelectorAll('[data-type-show]');

    var apply = function () {
      var checked = form.querySelector('input[name="donation_type"]:checked');
      var type = checked ? checked.value : 'money';
      sections.forEach(function (s) {
        var on = s.getAttribute('data-type') === type;
        s.hidden = !on;
        s.querySelectorAll('input, textarea').forEach(function (el) { el.disabled = !on; });
      });
      labels.forEach(function (l) {
        l.hidden = l.getAttribute('data-type-show').split(' ').indexOf(type) === -1;
      });
    };
    radios.forEach(function (r) { r.addEventListener('change', apply); });
    apply();

    form.querySelectorAll('[data-amount]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        form.querySelector('input[name="amount"]').value = btn.getAttribute('data-amount');
      });
    });
  }

  // ---- Confirm destructive actions ----
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault();
    });
  });
})();
