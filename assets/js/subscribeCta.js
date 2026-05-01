document.addEventListener('DOMContentLoaded', function () {
    // Ghost Portal fires these events on the document
    document.addEventListener('ghost-members:signup:success', handleSuccess);
    document.addEventListener('members:signup:success', handleSuccess);

    document.addEventListener('ghost-members:signup:error', handleError);
    document.addEventListener('members:signup:error', handleError);

    // Fallback: watch the form for Ghost's own data-members-* attribute changes
    document.querySelectorAll('[data-members-form]').forEach(function (form) {
        const observer = new MutationObserver(function () {
            if (form.classList.contains('success')) handleSuccess();
            if (form.classList.contains('error')) handleError();
        });
        observer.observe(form, { attributes: true, attributeFilter: ['class'] });
    });

    function handleSuccess() {
        document.querySelectorAll('.subscribe-cta__success').forEach(el => el.style.display = 'block');
        document.querySelectorAll('.subscribe-cta__error').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.subscribe-cta__form').forEach(el => el.style.display = 'none');
    }

    function handleError() {
        document.querySelectorAll('.subscribe-cta__error').forEach(el => el.style.display = 'block');
    }
});